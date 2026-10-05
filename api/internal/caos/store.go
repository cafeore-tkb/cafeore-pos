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
	"gorm.io/gorm/clause"

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

// OpRow は画面からの操作の記録。「1つ戻す」は、画面から送られた中身ではなく、この記録（サーバーが DB から取ったもの）で戻す。
type OpRow struct {
	ID   uuid.UUID `gorm:"type:uuid;primaryKey"`
	Day  string    `gorm:"type:date;not null;index"`
	Name string    `gorm:"not null"`
	// 操作で変わった・消えたカードの、操作の前の中身
	Before jsonValue[[]Drip] `gorm:"type:jsonb;not null"`
	// 操作で変わった・できたカードの、操作の後の中身（戻すときに、これから誰も触っていないかを updated_at で確かめる）
	After jsonValue[[]Drip] `gorm:"type:jsonb;not null"`
	// 操作で準備完了にした注文と、そのとき付けた ready_at（戻すときに、これから変わっていないかを確かめる）
	Readied   jsonValue[[]ReadyMark] `gorm:"type:jsonb;not null"`
	CreatedAt time.Time              `gorm:"not null;autoCreateTime:false"`
	// 戻した時刻。同じ操作は 2 回戻せない
	UndoneAt *time.Time
}

func (OpRow) TableName() string { return "caos_ops" }

// ReadyMark は操作で準備完了にした注文。
type ReadyMark struct {
	OrderID string    `json:"order_id"`
	ReadyAt time.Time `json:"ready_at"`
}

// ReadyFunc は注文の準備完了を付ける・外す処理。POS の PATCH /api/orders/{id}/ready と同じ切り替え
// （注文に付けるとカップにも同じ時刻を付け、外すとその時刻のカップを外す。handlers の setOrderReady）を、
// 今の状態と違うときだけ行う。注文の行をロックしてから今の状態を見る。
// 書いたときは、新しい注文の ready_at（外したときは nil）と true を返す。注文が無ければ gorm.ErrRecordNotFound。
//
// CaOS の「次へ」「1つ戻す」・統合相手の準備完了は、この処理で付け外しする。
type ReadyFunc func(tx *gorm.DB, orderID uuid.UUID, ready bool, now time.Time) (*time.Time, bool, error)

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
	db       *gorm.DB
	setReady ReadyFunc
	clock    func() time.Time
	// 画面からの操作をどの日の盤面に行うか（テストで差し替える）
	today func() string
}

// NewStore は Store を作る。setReady は POS の準備完了の処理（ReadyFunc）。
func NewStore(db *gorm.DB, setReady ReadyFunc) *Store {
	return &Store{db: db, setReady: setReady, clock: MonotonicClock(time.Now), today: func() string { return Day(time.Now()) }}
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
// 全部を 1 つのトランザクションで行う（途中で失敗したら、カードも注文も操作の記録も全部取り消される）：
//  1. 今日の盤面をロックし、今日の注文と照らし合わせてカードをそろえる（注文の連動が失敗していても、ここで追いつく）
//  2. 操作を行う。カードが全部終わった注文は、既存の準備完了の処理（ReadyFunc）で準備完了にする
//  3. 操作の記録（caos_ops）を残す。「1つ戻す」（undo）は、この記録で戻す
func (s *Store) Apply(op Op) (Result, error) {
	day := s.today()
	res := Result{Changed: []Drip{}, Deleted: []string{}, Readied: []string{}}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := lockDay(tx, day); err != nil {
			return err
		}
		b, err := s.readBoard(tx, day)
		if err != nil {
			return err
		}
		orders, err := dayOrders(tx, day)
		if err != nil {
			return err
		}
		ingest := &Changeset{}
		b.IngestOrders(ingest, orders, true)

		cs := &Changeset{}
		var readied []string
		if op.Name == "undo" {
			readied, err = s.undo(tx, day, b, cs, op.OpID)
		} else {
			res.OpID, readied, err = s.do(tx, day, b, cs, op)
		}
		if err != nil {
			return err
		}
		// 照らし合わせでカードが全部終わった注文（統合相手など）も準備完了にする（操作の記録には入れない）
		caughtUp, err := s.readyAll(tx, ingest.Completed.List())
		if err != nil {
			return err
		}
		if err := s.persist(tx, day, b, mergeChanges(b, ingest, cs)); err != nil {
			return err
		}
		res.Changed = b.Rows(cs.Changed.List())
		res.Deleted = cs.Deleted.List()
		res.Readied = append(readied, caughtUp...)
		return nil
	})
	if res.Deleted == nil {
		res.Deleted = []string{}
	}
	if res.Readied == nil {
		res.Readied = []string{}
	}
	return res, err
}

// do は操作を 1 つ行い、記録を残す。
func (s *Store) do(tx *gorm.DB, day string, b *Board, cs *Changeset, op Op) (string, []string, error) {
	before := b.Snapshot()
	if err := b.Apply(cs, op); err != nil {
		return "", nil, err
	}
	now := s.clock()
	var marks []ReadyMark
	var readied []string
	for _, id := range cs.Completed.List() {
		at, changed, err := s.setReady(tx, uuid.MustParse(id), true, now)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return "", nil, err
		}
		if changed {
			marks = append(marks, ReadyMark{OrderID: id, ReadyAt: *at})
			readied = append(readied, id)
		}
	}
	var beforeRows []Drip
	for _, id := range append(cs.Changed.List(), cs.Deleted.List()...) {
		if d, ok := before[id]; ok {
			beforeRows = append(beforeRows, d)
		}
	}
	rec := OpRow{
		ID: uuid.New(), Day: day, Name: op.Name, CreatedAt: now,
		Before: jsonValue[[]Drip]{orEmpty(beforeRows)}, After: jsonValue[[]Drip]{orEmpty(b.Rows(cs.Changed.List()))},
		Readied: jsonValue[[]ReadyMark]{orEmpty(marks)},
	}
	if err := tx.Create(&rec).Error; err != nil {
		return "", nil, err
	}
	return rec.ID.String(), readied, nil
}

// undo は記録した操作を取り消す（「1つ戻す」）。
// 操作のあと、関係するカードと注文が誰にも触られていないことを全部確かめてから戻す。1 つでも違えば ErrInvalid（何も変えない）。
func (s *Store) undo(tx *gorm.DB, day string, b *Board, cs *Changeset, opID string) ([]string, error) {
	id, err := uuid.Parse(opID)
	if err != nil {
		return nil, invalid("戻す操作が見つかりません")
	}
	var rec OpRow
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&rec, "id = ? AND day = ?", id, day).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, invalid("戻す操作が見つかりません")
		}
		return nil, err
	}
	if rec.UndoneAt != nil {
		return nil, invalid("この操作はもう元に戻しています")
	}
	// この操作で付けた準備完了が、そのまま残っているか（ほかの端末で外した・付け直した・提供済みにした、なら戻さない）
	for _, m := range rec.Readied.V {
		var o models.Order
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&o, "id = ?", m.OrderID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, invalid("注文が消されたため、元に戻せません")
			}
			return nil, err
		}
		if o.ServedAt != nil {
			return nil, invalid("提供済みの注文があるため、元に戻せません")
		}
		if o.ReadyAt == nil || !o.ReadyAt.Equal(m.ReadyAt) {
			return nil, invalid("ほかの端末で変更されたため、元に戻せません")
		}
	}
	// この操作で付けた準備完了は、このあと外すので、カードを戻すときの確かめでは外した状態として扱う
	for _, m := range rec.Readied.V {
		if o, ok := b.Orders[m.OrderID]; ok {
			o.Ready = false
		}
	}
	// カード：記録のあと誰も触っていなければ、記録の中身で戻す（確かめてから変える）
	if err := b.Restore(cs, rec.Before.V, rec.After.V); err != nil {
		return nil, err
	}
	now := s.clock()
	var unreadied []string
	for _, m := range rec.Readied.V {
		if _, _, err := s.setReady(tx, uuid.MustParse(m.OrderID), false, now); err != nil {
			return nil, err
		}
		unreadied = append(unreadied, m.OrderID)
	}
	if err := tx.Model(&rec).Update("undone_at", now).Error; err != nil {
		return nil, err
	}
	return unreadied, nil
}

// readyAll は注文をまとめて準備完了にする（消された注文は飛ばす）。準備完了にした注文を返す。
func (s *Store) readyAll(tx *gorm.DB, ids []string) ([]string, error) {
	now := s.clock()
	var readied []string
	for _, id := range ids {
		_, changed, err := s.setReady(tx, uuid.MustParse(id), true, now)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if changed {
			readied = append(readied, id)
		}
	}
	return readied, nil
}

// mergeChanges は、照らし合わせと操作の変更を 1 つにまとめる（保存を 1 回で行い、途中の状態で抽出中の索引に引っかからないように）。
func mergeChanges(b *Board, sets ...*Changeset) *Changeset {
	out := &Changeset{}
	for _, cs := range sets {
		for _, id := range append(cs.Changed.List(), cs.Deleted.List()...) {
			if _, ok := b.Drips[id]; ok {
				out.touch(id)
			} else {
				out.drop(id)
			}
		}
	}
	return out
}

func orEmpty[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}

// Drips はその日の全カード（配信に使う）。
func (s *Store) Drips(day string) ([]Drip, error) { return readDrips(s.db, day) }

// Today は画面からの操作を行う日（日本時間の今日）。
func (s *Store) Today() string { return s.today() }

// OrdersChanged は POS で注文が作られた・変わった・消えたときに、その注文のカードをそろえる。注文のハンドラーの tx の中で呼ぶ。
// POS で準備完了にした注文と統合していた相手の注文も、それでカードが全部終わったなら、同じ tx で準備完了にする。
// そうして準備完了にした注文を返す（ハンドラーが画面へ配る）。
func (s *Store) OrdersChanged(tx *gorm.DB, refs []OrderRef) ([]uuid.UUID, error) {
	byDay := map[string][]uuid.UUID{}
	var days []string
	for _, r := range refs {
		day := Day(r.CreatedAt)
		if _, ok := byDay[day]; !ok {
			days = append(days, day)
		}
		byDay[day] = append(byDay[day], r.ID)
	}
	var readied []uuid.UUID
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
			return nil, err
		}
		done, err := s.readyAll(tx, cs.Completed.List())
		if err != nil {
			return nil, err
		}
		for _, id := range done {
			readied = append(readied, uuid.MustParse(id))
		}
	}
	return readied, nil
}

// 作るもの（明細の品物と数）は、注文のカップ（order_cups。注文した時点の品物を 1 杯ずつ持つ）から読む。
// カップを持つ前の注文は、メニューの構成から読む。販売終了（論理削除）したメニュー・商品の注文も、カードは作る
func preloadOrderLines(db *gorm.DB) *gorm.DB {
	unscoped := func(db *gorm.DB) *gorm.DB { return db.Unscoped() }
	return db.Preload("OrderMenus.Menu", unscoped).
		Preload("OrderMenus.Menu.MenuItems").
		Preload("OrderMenus.Menu.MenuItems.Item", unscoped).
		Preload("OrderMenus.Menu.MenuItems.Item.ItemType", unscoped).
		Preload("OrderCups", func(db *gorm.DB) *gorm.DB { return db.Order("order_cups.position") }).
		Preload("OrderCups.Item", unscoped).
		Preload("OrderCups.Item.ItemType", unscoped)
}

func toOrders(orders []models.Order) []Order {
	out := make([]Order, 0, len(orders))
	for _, o := range orders {
		order := Order{ID: o.ID.String(), OrderNo: o.OrderId, CreatedAt: o.CreatedAt, Ready: o.ReadyAt != nil, Served: o.ServedAt != nil}
		cups := map[uuid.UUID][]models.OrderCup{}
		for _, cup := range o.OrderCups {
			cups[cup.OrderMenuID] = append(cups[cup.OrderMenuID], cup)
		}
		for _, line := range o.OrderMenus {
			if len(cups[line.ID]) == 0 {
				for _, mi := range line.Menu.MenuItems {
					order.Lines = append(order.Lines, OrderLine{
						Assignee: line.Assignee, ItemID: mi.Item.ID.String(), Name: mi.Item.Name, Abbr: mi.Item.Abbr,
						Type: mi.Item.ItemType.Name, Quantity: mi.Quantity,
					})
				}
				continue
			}
			// 同じ明細の同じ品物のカップは 1 行にまとめる（並びはカップの順）
			at := map[uuid.UUID]int{}
			for _, cup := range cups[line.ID] {
				if i, ok := at[cup.ItemID]; ok {
					order.Lines[i].Quantity++
					continue
				}
				at[cup.ItemID] = len(order.Lines)
				order.Lines = append(order.Lines, OrderLine{
					Assignee: line.Assignee, ItemID: cup.ItemID.String(), Name: cup.Item.Name, Abbr: cup.Item.Abbr,
					Type: cup.Item.ItemType.Name, Quantity: 1,
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
