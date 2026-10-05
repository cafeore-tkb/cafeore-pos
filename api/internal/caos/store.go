package caos

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// 盤面の保存。新しい表は抽出カードの caos_drips だけ（api/sql/2026-10_caos.sql。本番は手で流す）。
// 1 つの営業日への処理は、その日の advisory lock を取って 1 件ずつ順番に行う（ロックのための表は持たない）。
// 配信は注文と同じく DB の通知から：caos_drips が変わるとトリガーが caos_drips_changed を送り、
// 各インスタンスが DB から今日のカードを読み直して WebSocket で配る（handlers/order_listener.go）。

// ChangedChannel は caos_drips が変わったことを知らせる DB の通知のチャンネル。
const ChangedChannel = "caos_drips_changed"

// DripRow は抽出カードの行。order_ids と杯数は明細（lines）から求めるので持たない。
type DripRow struct {
	ID          uuid.UUID             `gorm:"type:uuid;primaryKey"`
	Day         string                `gorm:"type:date;not null;index"`
	Status      string                `gorm:"not null"`
	Dripper     *int                  `gorm:"type:smallint"`
	QueuePos    float64               `gorm:"type:double precision;not null"`
	Lines       jsonValue[[]DripLine] `gorm:"type:jsonb;not null"`
	RebrewOf    *uuid.UUID            `gorm:"type:uuid"`
	Interrupted bool                  `gorm:"not null;default:false"`
	StartedAt   *time.Time
	FinishedAt  *time.Time
	CreatedAt   time.Time `gorm:"not null;autoCreateTime:false"`
	UpdatedAt   time.Time `gorm:"not null;autoUpdateTime:false"`
}

func (DripRow) TableName() string { return "caos_drips" }

// jsonValue は jsonb の列。
type jsonValue[T any] struct{ V T }

func (j jsonValue[T]) Value() (driver.Value, error) {
	b, err := json.Marshal(j.V)
	return string(b), err
}

func (j *jsonValue[T]) Scan(src any) error {
	switch v := src.(type) {
	case []byte:
		return json.Unmarshal(v, &j.V)
	case string:
		return json.Unmarshal([]byte(v), &j.V)
	case nil:
		return nil
	default:
		return fmt.Errorf("jsonb の値が読めません：%T", src)
	}
}

func toRow(day string, d Drip) DripRow {
	row := DripRow{
		ID: uuid.MustParse(d.ID), Day: day, Status: string(d.Status), Dripper: d.Dripper, QueuePos: d.QueuePos,
		Lines: jsonValue[[]DripLine]{d.Lines}, Interrupted: d.Interrupted,
		StartedAt: d.StartedAt, FinishedAt: d.FinishedAt, CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt,
	}
	if d.RebrewOf != nil {
		id := uuid.MustParse(*d.RebrewOf)
		row.RebrewOf = &id
	}
	return row
}

func fromRow(r DripRow) Drip {
	lines := r.Lines.V
	if lines == nil {
		lines = []DripLine{}
	}
	d := Drip{
		ID: r.ID.String(), Status: Status(r.Status), Dripper: r.Dripper, QueuePos: r.QueuePos,
		OrderIDs: distinctOrders(lines), Lines: lines, Cups: sumCups(lines), Interrupted: r.Interrupted,
		StartedAt: utc(r.StartedAt), FinishedAt: utc(r.FinishedAt), CreatedAt: r.CreatedAt.UTC(), UpdatedAt: r.UpdatedAt.UTC(),
	}
	if d.OrderIDs == nil {
		d.OrderIDs = []string{}
	}
	if r.RebrewOf != nil {
		d.RebrewOf = ptr(r.RebrewOf.String())
	}
	return d
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	return ptr(t.UTC())
}

// ---------------------------------------------------------------- 営業日

var jst = time.FixedZone("JST", 9*60*60)

// Day は日本時間の日付（YYYY-MM-DD）。
func Day(t time.Time) string { return t.In(jst).Format(time.DateOnly) }

// ParseDay は YYYY-MM-DD を確かめ、その日の始まり（日本時間 0:00）を返す。
func ParseDay(day string) (time.Time, error) {
	t, err := time.ParseInLocation(time.DateOnly, day, jst)
	if err != nil || t.Format(time.DateOnly) != day {
		return time.Time{}, invalid("日付は YYYY-MM-DD です")
	}
	return t, nil
}

// ---------------------------------------------------------------- Store

// Store は盤面の保存と、POS の注文との連動。
type Store struct {
	db    *gorm.DB
	clock func() time.Time
	// 画面からの操作をどの日の盤面に行うか（テストで差し替える）
	today func() string
}

// NewStore は Store を作る。
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db, clock: MonotonicClock(time.Now), today: func() string { return Day(time.Now()) }}
}

// OrderRef は変わった注文（どの盤面かは注文を受けた日で決まる）。
type OrderRef struct {
	ID        uuid.UUID
	CreatedAt time.Time
}

// LockBoard は注文を受けた日の盤面をロックする（tx が終わるまで、その日の盤面への処理を止める）。
//
// ロックの順番は、どの処理でも「盤面 → 注文」にそろえる。注文を書き換えるハンドラーは、注文の行を書く前にこれを呼ぶ
// （逆の順番だと、同じ注文を同時に触ったときにデッドロックになる）。
func (s *Store) LockBoard(tx *gorm.DB, orderCreatedAt time.Time) error {
	return lockDay(tx, Day(orderCreatedAt))
}

func lockDay(tx *gorm.DB, day string) error {
	if _, err := ParseDay(day); err != nil {
		return err
	}
	return tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "caos:"+day).Error
}

// readBoard はその日のカードと注文の状態を読む。
func (s *Store) readBoard(tx *gorm.DB, day string) (*Board, error) {
	start, err := ParseDay(day)
	if err != nil {
		return nil, err
	}
	drips, err := readDrips(tx, day)
	if err != nil {
		return nil, err
	}
	var orders []models.Order
	if err := tx.Select("id", "order_id", "created_at", "ready_at", "served_at").
		Where("created_at >= ? AND created_at < ?", start, start.AddDate(0, 0, 1)).Find(&orders).Error; err != nil {
		return nil, err
	}
	states := make([]OrderState, len(orders))
	for i, o := range orders {
		states[i] = OrderState{ID: o.ID.String(), OrderNo: o.OrderId, CreatedAt: o.CreatedAt, Ready: o.ReadyAt != nil, Served: o.ServedAt != nil}
	}
	return NewBoard(drips, states, s.clock, nil), nil
}

func readDrips(tx *gorm.DB, day string) ([]Drip, error) {
	var rows []DripRow
	if err := tx.Where("day = ?", day).Order("created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	drips := make([]Drip, len(rows))
	for i, r := range rows {
		drips[i] = fromRow(r)
	}
	return drips, nil
}

// withBoard はその日の盤面をロックして読み、fn で変えたカードを保存する。tx の中で呼ぶこと。
// fn が読むもの（注文の明細など）も、ロックを取ったあとに tx から読むこと。
func (s *Store) withBoard(tx *gorm.DB, day string, fn func(tx *gorm.DB, b *Board, cs *Changeset) error) (*Board, *Changeset, error) {
	if err := lockDay(tx, day); err != nil {
		return nil, nil, err
	}
	b, err := s.readBoard(tx, day)
	if err != nil {
		return nil, nil, err
	}
	cs := &Changeset{}
	if err := fn(tx, b, cs); err != nil {
		return nil, nil, err
	}
	if err := s.persist(tx, day, b, cs); err != nil {
		return nil, nil, err
	}
	return b, cs, nil
}

func (s *Store) persist(tx *gorm.DB, day string, b *Board, cs *Changeset) error {
	// 1 人 1 枚の抽出中の索引に、書き換えの途中で引っかからないよう、変わった行はいったん消してから入れ直す
	ids := append(cs.Deleted.List(), cs.Changed.List()...)
	if len(ids) == 0 {
		return nil
	}
	if err := tx.Where("id IN ?", ids).Delete(&DripRow{}).Error; err != nil {
		return err
	}
	changed := b.Rows(cs.Changed.List())
	if len(changed) == 0 {
		return nil
	}
	rows := make([]DripRow, len(changed))
	for i, d := range changed {
		rows[i] = toRow(day, d)
	}
	return tx.Create(&rows).Error
}

func dayOrders(tx *gorm.DB, day string) ([]Order, error) {
	start, err := ParseDay(day)
	if err != nil {
		return nil, err
	}
	var orders []models.Order
	if err := preloadOrderLines(tx).Where("created_at >= ? AND created_at < ?", start, start.AddDate(0, 0, 1)).Find(&orders).Error; err != nil {
		return nil, err
	}
	return toOrders(orders), nil
}

// Apply は画面からの操作を今日の盤面に 1 つ行う。ルールに合わなければ ErrInvalid（何も変えない）。
//
// 操作の前に今日の注文と照らし合わせてカードをそろえる（注文の連動が失敗していても、ここで追いつく）。
// カードが全部終わった注文（Completed）の準備完了は、画面が既存の PATCH /api/orders/{id}/ready で付ける。
func (s *Store) Apply(op Op) (Result, error) {
	var res Result
	day := s.today()
	err := s.db.Transaction(func(tx *gorm.DB) error {
		b, cs, err := s.withBoard(tx, day, func(tx *gorm.DB, b *Board, cs *Changeset) error {
			orders, err := dayOrders(tx, day)
			if err != nil {
				return err
			}
			// 照らし合わせで終わった注文（統合相手など）も Completed に入る。画面はそれも準備完了にする
			b.IngestOrders(cs, orders, true)
			return b.Apply(cs, op)
		})
		if err != nil {
			return err
		}
		res = Result{Changed: b.Rows(cs.Changed.List()), Deleted: cs.Deleted.List(), Completed: cs.Completed.List()}
		return nil
	})
	if res.Changed == nil {
		res.Changed = []Drip{}
	}
	if res.Deleted == nil {
		res.Deleted = []string{}
	}
	if res.Completed == nil {
		res.Completed = []string{}
	}
	return res, err
}

// Drips はその日の全カード（配信に使う）。
func (s *Store) Drips(day string) ([]Drip, error) { return readDrips(s.db, day) }

// Today は画面からの操作を行う日（日本時間の今日）。
func (s *Store) Today() string { return s.today() }

// OrdersChanged は POS で注文が作られた・変わった・消えたときに、その注文のカードをそろえる。注文のハンドラーの tx の中で呼ぶ。
// POS で準備完了にした注文と統合していた相手の注文も、それでカードが全部終わったなら、同じ tx で準備完了にする。
func (s *Store) OrdersChanged(tx *gorm.DB, refs []OrderRef) error {
	byDay := map[string][]uuid.UUID{}
	var days []string
	for _, r := range refs {
		day := Day(r.CreatedAt)
		if _, ok := byDay[day]; !ok {
			days = append(days, day)
		}
		byDay[day] = append(byDay[day], r.ID)
	}
	for _, day := range days {
		ids := byDay[day]
		_, cs, err := s.withBoard(tx, day, func(tx *gorm.DB, b *Board, cs *Changeset) error {
			// 注文はロックを取ったあとに読む（その間に消された・変わった注文で、カードを作り直さないように）
			var orders []models.Order
			if err := preloadOrderLines(tx).Where("id IN ?", ids).Find(&orders).Error; err != nil {
				return err
			}
			found := map[string]bool{}
			for _, o := range orders {
				found[o.ID.String()] = true
			}
			b.IngestOrders(cs, toOrders(orders), false)
			for _, id := range ids {
				if !found[id.String()] {
					b.RemoveOrder(cs, id.String())
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
		if completed := cs.Completed.List(); len(completed) > 0 {
			if err := tx.Model(&models.Order{}).Where("id IN ? AND ready_at IS NULL", completed).Update("ready_at", s.clock()).Error; err != nil {
				return err
			}
		}
	}
	return nil
}

// 販売終了（論理削除）したメニュー・商品の注文も、カードは作る
func preloadOrderLines(db *gorm.DB) *gorm.DB {
	unscoped := func(db *gorm.DB) *gorm.DB { return db.Unscoped() }
	return db.Preload("OrderMenus.Menu", unscoped).
		Preload("OrderMenus.Menu.MenuItems").
		Preload("OrderMenus.Menu.MenuItems.Item", unscoped).
		Preload("OrderMenus.Menu.MenuItems.Item.ItemType", unscoped)
}

func toOrders(orders []models.Order) []Order {
	out := make([]Order, 0, len(orders))
	for _, o := range orders {
		order := Order{ID: o.ID.String(), OrderNo: o.OrderId, CreatedAt: o.CreatedAt, Ready: o.ReadyAt != nil, Served: o.ServedAt != nil}
		for _, line := range o.OrderMenus {
			for _, mi := range line.Menu.MenuItems {
				order.Lines = append(order.Lines, OrderLine{
					Assignee: line.Assignee, ItemID: mi.Item.ID.String(), Name: mi.Item.Name, Abbr: mi.Item.Abbr,
					Type: mi.Item.ItemType.Name, Quantity: mi.Quantity,
				})
			}
		}
		out = append(out, order)
	}
	slices.SortFunc(out, func(a, b Order) int { return a.CreatedAt.Compare(b.CreatedAt) })
	return out
}

// IsInvalid はルールに合わない操作のエラーか。
func IsInvalid(err error) bool { return errors.Is(err, ErrInvalid) }
