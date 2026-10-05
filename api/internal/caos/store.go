package caos

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
)

// 盤面の保存。1 つの営業日への処理は、caos_boards のその日の行をロックして 1 件ずつ順番に行う。
// 表の形は api/sql/2026-10_caos.sql（本番は手で流す）と同じ。

// ChangedChannel は盤面が変わったことをほかのインスタンスへ知らせる DB の通知のチャンネル。payload は "日付:版"。
const ChangedChannel = "caos_drips_changed"

// BoardRow は営業日ごとの盤面の版。変わるたびに 1 ずつ増える（画面は飛んだのに気づいたら読み直す）。
type BoardRow struct {
	Day     string `gorm:"type:date;primaryKey"`
	Version int64  `gorm:"not null;default:0"`
}

func (BoardRow) TableName() string { return "caos_boards" }

// DripRow は抽出カードの行。
type DripRow struct {
	ID          uuid.UUID             `gorm:"type:uuid;primaryKey"`
	Day         string                `gorm:"type:date;not null;index"`
	Status      string                `gorm:"not null"`
	Dripper     *int                  `gorm:"type:smallint"`
	QueuePos    float64               `gorm:"type:double precision;not null"`
	OrderIDs    jsonValue[[]string]   `gorm:"type:jsonb;not null"`
	Lines       jsonValue[[]DripLine] `gorm:"type:jsonb;not null"`
	Cups        int                   `gorm:"type:smallint;not null"`
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
		OrderIDs: jsonValue[[]string]{d.OrderIDs}, Lines: jsonValue[[]DripLine]{d.Lines}, Cups: d.Cups,
		Interrupted: d.Interrupted, StartedAt: d.StartedAt, FinishedAt: d.FinishedAt, CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt,
	}
	if d.RebrewOf != nil {
		id := uuid.MustParse(*d.RebrewOf)
		row.RebrewOf = &id
	}
	return row
}

func fromRow(r DripRow) Drip {
	d := Drip{
		ID: r.ID.String(), Status: Status(r.Status), Dripper: r.Dripper, QueuePos: r.QueuePos,
		OrderIDs: r.OrderIDs.V, Lines: r.Lines.V, Cups: r.Cups, Interrupted: r.Interrupted,
		StartedAt: utc(r.StartedAt), FinishedAt: utc(r.FinishedAt), CreatedAt: r.CreatedAt.UTC(), UpdatedAt: r.UpdatedAt.UTC(),
	}
	if r.RebrewOf != nil {
		d.RebrewOf = ptr(r.RebrewOf.String())
	}
	if d.OrderIDs == nil {
		d.OrderIDs = []string{}
	}
	if d.Lines == nil {
		d.Lines = []DripLine{}
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
}

// NewStore は Store を作る。
func NewStore(db *gorm.DB) *Store { return &Store{db: db, clock: MonotonicClock(time.Now)} }

// Applied は保存した変更。ハンドラーはコミットのあとにこれを WebSocket で配る。
type Applied struct {
	Day       string
	Version   int64
	Changed   []Drip
	Deleted   []string
	Readied   []string
	Unreadied []string
}

// Result は操作を呼んだ画面に返す形。
func (a *Applied) Result() Result {
	r := Result{Day: a.Day, Version: a.Version, Changed: a.Changed, Deleted: a.Deleted, Readied: a.Readied}
	if r.Changed == nil {
		r.Changed = []Drip{}
	}
	if r.Deleted == nil {
		r.Deleted = []string{}
	}
	if r.Readied == nil {
		r.Readied = []string{}
	}
	return r
}

// Snapshot はその日の盤面（全カードと版）。
type Snapshot struct {
	Day     string `json:"day"`
	Version int64  `json:"v"`
	Drips   []Drip `json:"drips"`
}

// OrderRef は変わった注文（どの盤面かは注文を受けた日で決まる）。
type OrderRef struct {
	ID        uuid.UUID
	CreatedAt time.Time
}

// withBoard はその日の盤面をロックして読み、fn で変えたものを保存する。tx の中で呼ぶこと。
func (s *Store) withBoard(tx *gorm.DB, day string, fn func(b *Board, cs *Changeset) error) (*Applied, *Board, error) {
	start, err := ParseDay(day)
	if err != nil {
		return nil, nil, err
	}
	if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&BoardRow{Day: day}).Error; err != nil {
		return nil, nil, err
	}
	var board BoardRow
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&board, "day = ?", day).Error; err != nil {
		return nil, nil, err
	}

	var rows []DripRow
	if err := tx.Where("day = ?", day).Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	drips := make([]Drip, len(rows))
	for i, r := range rows {
		drips[i] = fromRow(r)
	}
	var orders []models.Order
	if err := tx.Select("id", "order_id", "created_at", "ready_at", "served_at").
		Where("created_at >= ? AND created_at < ?", start, start.AddDate(0, 0, 1)).Find(&orders).Error; err != nil {
		return nil, nil, err
	}
	states := make([]OrderState, len(orders))
	for i, o := range orders {
		states[i] = OrderState{ID: o.ID.String(), OrderNo: o.OrderId, CreatedAt: o.CreatedAt, Ready: o.ReadyAt != nil, Served: o.ServedAt != nil}
	}

	b := NewBoard(drips, states, s.clock, nil)
	cs := &Changeset{}
	if err := fn(b, cs); err != nil {
		return nil, nil, err
	}
	applied := &Applied{Day: day, Version: board.Version, Changed: b.Rows(cs.Changed.List()), Deleted: cs.Deleted.List(), Readied: cs.Readied.List(), Unreadied: cs.Unreadied.List()}
	if err := s.persist(tx, day, applied); err != nil {
		return nil, nil, err
	}
	return applied, b, nil
}

func (s *Store) persist(tx *gorm.DB, day string, a *Applied) error {
	// 1 人 1 枚の抽出中の索引に、書き換えの途中で引っかからないよう、変わった行はいったん消してから入れ直す
	ids := append(slices.Clone(a.Deleted), make([]string, 0, len(a.Changed))...)
	for _, d := range a.Changed {
		ids = append(ids, d.ID)
	}
	if len(ids) > 0 {
		if err := tx.Where("id IN ?", ids).Delete(&DripRow{}).Error; err != nil {
			return err
		}
	}
	if len(a.Changed) > 0 {
		rows := make([]DripRow, len(a.Changed))
		for i, d := range a.Changed {
			rows[i] = toRow(day, d)
		}
		if err := tx.Create(&rows).Error; err != nil {
			return err
		}
	}
	now := s.clock()
	if len(a.Readied) > 0 {
		if err := tx.Model(&models.Order{}).Where("id IN ? AND ready_at IS NULL", a.Readied).Update("ready_at", now).Error; err != nil {
			return err
		}
	}
	if len(a.Unreadied) > 0 {
		if err := tx.Model(&models.Order{}).Where("id IN ? AND served_at IS NULL", a.Unreadied).Update("ready_at", nil).Error; err != nil {
			return err
		}
	}
	if len(ids) == 0 {
		return nil
	}
	a.Version++
	if err := tx.Model(&BoardRow{}).Where("day = ?", day).Update("version", a.Version).Error; err != nil {
		return err
	}
	// ほかのインスタンスにつないでいる画面にも知らせる（コミットしたときに届く）
	return tx.Exec("SELECT pg_notify(?, ?)", ChangedChannel, day+":"+strconv.FormatInt(a.Version, 10)).Error
}

// Apply は画面からの操作を 1 つ行う。ルールに合わなければ ErrInvalid（何も変えない）。
func (s *Store) Apply(day string, op Op) (*Applied, error) {
	var applied *Applied
	err := s.db.Transaction(func(tx *gorm.DB) error {
		a, _, err := s.withBoard(tx, day, func(b *Board, cs *Changeset) error { return b.Apply(cs, op) })
		applied = a
		return err
	})
	return applied, err
}

// Load はその日の盤面を読む。読む前に、その日の注文と照らし合わせてカードをそろえる（取りこぼしがあっても追いつく）。
func (s *Store) Load(day string) (*Snapshot, *Applied, error) {
	start, err := ParseDay(day)
	if err != nil {
		return nil, nil, err
	}
	var snap *Snapshot
	var applied *Applied
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var orders []models.Order
		if err := preloadOrderLines(tx).Where("created_at >= ? AND created_at < ?", start, start.AddDate(0, 0, 1)).Find(&orders).Error; err != nil {
			return err
		}
		a, b, err := s.withBoard(tx, day, func(b *Board, cs *Changeset) error {
			b.IngestOrders(cs, toOrders(orders), true)
			return nil
		})
		if err != nil {
			return err
		}
		applied = a
		snap = &Snapshot{Day: day, Version: a.Version, Drips: b.List()}
		return nil
	})
	return snap, applied, err
}

// OrdersChanged は POS で注文が作られた・変わった・消えたときに、その注文のカードをそろえる。注文のハンドラーの tx の中で呼ぶ。
func (s *Store) OrdersChanged(tx *gorm.DB, refs []OrderRef) ([]*Applied, error) {
	byDay := map[string][]uuid.UUID{}
	var days []string
	for _, r := range refs {
		day := Day(r.CreatedAt)
		if _, ok := byDay[day]; !ok {
			days = append(days, day)
		}
		byDay[day] = append(byDay[day], r.ID)
	}
	var out []*Applied
	for _, day := range days {
		ids := byDay[day]
		var orders []models.Order
		if err := preloadOrderLines(tx).Where("id IN ?", ids).Find(&orders).Error; err != nil {
			return nil, err
		}
		a, _, err := s.withBoard(tx, day, func(b *Board, cs *Changeset) error {
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
		out = append(out, a)
	}
	return out, nil
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
