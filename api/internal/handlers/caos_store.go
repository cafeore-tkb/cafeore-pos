package handlers

import (
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// CaOS の盤面の保存と、POS の注文との連動。盤面の決まり（割当・次へ・統合など）は caos パッケージ（DB を使わない）にある。
// 新しい表は抽出カードの caos_drips、列の担当者の caos_lanes、操作の記録の caos_ops だけ
// （models の CaosDripRow・CaosLaneRow・CaosOpRow。ほかの表と同じく models.All() で作る）。
// 実データテストの練習用の盤面（caos_practices）は別の保存（caos_practice_store.go の CaosPracticeStore）で、ここの表には触らない。
// 1 つの営業日への処理は、その日の advisory lock を取って 1 件ずつ順番に行う（ロックのための表は持たない）。
// 配信は注文と同じ：カードを変えたインスタンスが自分の画面へ配り、DB の通知 caos_drips_changed でほかのインスタンスに知らせる。
// 受けたインスタンスは DB から今日のカードと列の担当者を読み直して、自分の画面へ配る（caos.go・order_listener.go）。
// 列の担当者を替えたときも同じ通知で知らせる（チャンネルの名前は caos_drips_changed のまま）。

// dripsChangedChannel は caos_drips（と caos_lanes）が変わったことをインスタンス同士で知らせる DB の通知のチャンネル。
const dripsChangedChannel = "caos_drips_changed"

func toCaosDripRow(day string, d caos.Drip) models.CaosDripRow {
	row := models.CaosDripRow{
		ID: uuid.MustParse(d.ID), Day: day, Status: d.Status, Dripper: d.Dripper, QueuePos: d.QueuePos,
		Lines: orEmpty(d.Lines), Interrupted: d.Interrupted,
		StartedAt: d.StartedAt, FinishedAt: d.FinishedAt, CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt,
	}
	if d.RebrewOf != nil {
		id := uuid.MustParse(*d.RebrewOf)
		row.RebrewOf = &id
	}
	return row
}

func fromCaosDripRow(r models.CaosDripRow) caos.Drip {
	lines := orEmpty(r.Lines)
	d := caos.Drip{
		ID: r.ID.String(), Status: r.Status, Dripper: r.Dripper, QueuePos: r.QueuePos,
		OrderIDs: orEmpty(caos.OrderIDsOf(lines)), Lines: lines, Cups: caos.CupsOf(lines), Interrupted: r.Interrupted,
		StartedAt: utcPtr(r.StartedAt), FinishedAt: utcPtr(r.FinishedAt), CreatedAt: r.CreatedAt.UTC(), UpdatedAt: r.UpdatedAt.UTC(),
	}
	if r.RebrewOf != nil {
		id := r.RebrewOf.String()
		d.RebrewOf = &id
	}
	return d
}

func utcPtr(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// ---------------------------------------------------------------- CaosStore

// CaosStore は CaOS の盤面の保存と、POS の注文との連動。
type CaosStore struct {
	db    *gorm.DB
	clock func() time.Time
	// 画面からの操作をどの日の盤面に行うか（テストで差し替える）
	today func() string
}

// NewCaosStore は CaosStore を作る。
func NewCaosStore(db *gorm.DB) *CaosStore {
	return &CaosStore{db: db, clock: caos.MonotonicClock(time.Now), today: func() string { return caos.Day(time.Now()) }}
}

// caosOrderRef は変わった注文（どの盤面かは注文を受けた日で決まる）。
type caosOrderRef struct {
	ID        uuid.UUID
	CreatedAt time.Time
}

// LockBoard は注文を受けた日の盤面をロックする（tx が終わるまで、その日の盤面への処理を止める）。
//
// ロックの順番は、どの処理でも「盤面 → 注文」にそろえる。注文を書き換えるハンドラーは、注文の行を書く前にこれを呼ぶ
// （逆の順番だと、同じ注文を同時に触ったときにデッドロックになる）。
func (s *CaosStore) LockBoard(tx *gorm.DB, orderCreatedAt time.Time) error {
	return lockCaosDay(tx, caos.Day(orderCreatedAt))
}

func lockCaosDay(tx *gorm.DB, day string) error {
	if _, err := caos.ParseDay(day); err != nil {
		return err
	}
	return tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "caos:"+day).Error
}

// readBoard はその日のカードと注文の状態を読む。
func (s *CaosStore) readBoard(tx *gorm.DB, day string) (*caos.Board, error) {
	start, err := caos.ParseDay(day)
	if err != nil {
		return nil, err
	}
	drips, err := readCaosDrips(tx, day)
	if err != nil {
		return nil, err
	}
	var orders []models.Order
	if err := tx.Select("id", "order_id", "created_at", "ready_at", "served_at").
		Where("created_at >= ? AND created_at < ?", start, start.AddDate(0, 0, 1)).Find(&orders).Error; err != nil {
		return nil, err
	}
	states := make([]caos.OrderState, len(orders))
	for i, o := range orders {
		states[i] = caos.OrderState{ID: o.ID.String(), OrderNo: o.OrderId, CreatedAt: o.CreatedAt, Ready: o.ReadyAt != nil, Served: o.ServedAt != nil}
	}
	b := caos.NewBoard(drips, states, s.clock, nil)
	lanes, err := readCaosLanes(tx, day)
	if err != nil {
		return nil, err
	}
	b.LoadLanes(lanes)
	return b, nil
}

// readCaosLanes はその日の保存してある列の担当者（一度も替えていない列は入らない）。
func readCaosLanes(tx *gorm.DB, day string) ([]caos.Lane, error) {
	var rows []models.CaosLaneRow
	if err := tx.Where("day = ?", day).Order("dripper").Find(&rows).Error; err != nil {
		return nil, err
	}
	lanes := make([]caos.Lane, len(rows))
	for i, r := range rows {
		at := r.UpdatedAt.UTC()
		lanes[i] = caos.Lane{Dripper: r.Dripper, Name: r.Name, Senior: r.Senior, UpdatedAt: &at}
	}
	return lanes, nil
}

// persistCaosLanes は変わった列の担当者を書く。一度も替えていない状態に戻した列（「1つ戻す」）は行を消す。
func persistCaosLanes(tx *gorm.DB, day string, lanes []caos.Lane) error {
	for _, l := range lanes {
		if l.UpdatedAt == nil {
			if err := tx.Where("day = ? AND dripper = ?", day, l.Dripper).Delete(&models.CaosLaneRow{}).Error; err != nil {
				return err
			}
			continue
		}
		row := models.CaosLaneRow{Day: day, Dripper: l.Dripper, Name: l.Name, Senior: l.Senior, UpdatedAt: *l.UpdatedAt}
		if err := tx.Clauses(clause.OnConflict{
			Columns:   []clause.Column{{Name: "day"}, {Name: "dripper"}},
			DoUpdates: clause.AssignmentColumns([]string{"name", "senior", "updated_at"}),
		}).Create(&row).Error; err != nil {
			return err
		}
	}
	return nil
}

func readCaosDrips(tx *gorm.DB, day string) ([]caos.Drip, error) {
	var rows []models.CaosDripRow
	if err := tx.Where("day = ?", day).Order("created_at, id").Find(&rows).Error; err != nil {
		return nil, err
	}
	drips := make([]caos.Drip, len(rows))
	for i, r := range rows {
		drips[i] = fromCaosDripRow(r)
	}
	return drips, nil
}

// withBoard はその日の盤面をロックして読み、fn で変えたカードを保存する。tx の中で呼ぶこと。
// fn が読むもの（注文の明細など）も、ロックを取ったあとに tx から読むこと。
func (s *CaosStore) withBoard(tx *gorm.DB, day string, fn func(tx *gorm.DB, b *caos.Board, cs *caos.Changeset) error) (*caos.Board, *caos.Changeset, error) {
	if err := lockCaosDay(tx, day); err != nil {
		return nil, nil, err
	}
	b, err := s.readBoard(tx, day)
	if err != nil {
		return nil, nil, err
	}
	cs := &caos.Changeset{}
	if err := fn(tx, b, cs); err != nil {
		return nil, nil, err
	}
	if err := s.persist(tx, day, b, cs); err != nil {
		return nil, nil, err
	}
	return b, cs, nil
}

func (s *CaosStore) persist(tx *gorm.DB, day string, b *caos.Board, cs *caos.Changeset) error {
	if err := persistCaosLanes(tx, day, b.LaneRows(cs.Lanes)); err != nil {
		return err
	}
	// 1 人 1 枚の抽出中の索引に、書き換えの途中で引っかからないよう、変わった行はいったん消してから入れ直す
	ids := append(cs.Deleted.List(), cs.Changed.List()...)
	if len(ids) == 0 {
		return nil
	}
	if err := tx.Where("id IN ?", ids).Delete(&models.CaosDripRow{}).Error; err != nil {
		return err
	}
	changed := b.Rows(cs.Changed.List())
	if len(changed) == 0 {
		return nil
	}
	rows := make([]models.CaosDripRow, len(changed))
	for i, d := range changed {
		rows[i] = toCaosDripRow(day, d)
	}
	return tx.Create(&rows).Error
}

func caosDayOrders(tx *gorm.DB, day string) ([]caos.Order, error) {
	start, err := caos.ParseDay(day)
	if err != nil {
		return nil, err
	}
	var orders []models.Order
	if err := preloadCaosOrderLines(tx).Where("created_at >= ? AND created_at < ?", start, start.AddDate(0, 0, 1)).Find(&orders).Error; err != nil {
		return nil, err
	}
	return toCaosOrders(orders), nil
}

// Apply は画面からの操作を今日の盤面に 1 つ行う。ルールに合わなければ caos.ErrInvalid（何も変えない）。
//
// 全部を 1 つのトランザクションで行う（途中で失敗したら、カードも注文も操作の記録も全部取り消される）：
//  1. 今日の盤面をロックし、今日の注文と照らし合わせてカードをそろえる（注文の連動が失敗していても、ここで追いつく）
//  2. 操作を行う。カードが全部終わった注文は、既存の準備完了の処理（setOrderReady）で準備完了にする
//  3. 操作の記録（caos_ops）を残す。「1つ戻す」（undo）は、この記録で戻す
func (s *CaosStore) Apply(op caos.Op) (caos.Result, error) {
	day := s.today()
	res := caos.Result{Changed: []caos.Drip{}, Deleted: []string{}, Readied: []string{}, Lanes: []caos.Lane{}}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := lockCaosDay(tx, day); err != nil {
			return err
		}
		b, err := s.readBoard(tx, day)
		if err != nil {
			return err
		}
		orders, err := caosDayOrders(tx, day)
		if err != nil {
			return err
		}
		ingest := &caos.Changeset{}
		b.IngestOrders(ingest, orders, true)

		cs := &caos.Changeset{}
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
		if err := s.persist(tx, day, b, b.MergeChanges(ingest, cs)); err != nil {
			return err
		}
		res.Changed = b.Rows(cs.Changed.List())
		res.Deleted = cs.Deleted.List()
		res.Readied = append(readied, caughtUp...)
		res.Lanes = b.LaneRows(cs.Lanes)
		return nil
	})
	if res.Deleted == nil {
		res.Deleted = []string{}
	}
	if res.Readied == nil {
		res.Readied = []string{}
	}
	if err != nil {
		res.Lanes = []caos.Lane{}
	}
	return res, err
}

// do は操作を 1 つ行い、記録を残す。
func (s *CaosStore) do(tx *gorm.DB, day string, b *caos.Board, cs *caos.Changeset, op caos.Op) (string, []string, error) {
	record, err := b.ApplyRecorded(cs, op)
	if err != nil {
		return "", nil, err
	}
	now := s.clock()
	var marks []caos.ReadyMark
	var readied []string
	for _, id := range cs.Completed.List() {
		at, changed, err := setOrderReady(tx, uuid.MustParse(id), true, now)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return "", nil, err
		}
		if changed {
			marks = append(marks, caos.ReadyMark{OrderID: id, ReadyAt: *at})
			readied = append(readied, id)
		}
	}
	rec := models.CaosOpRow{
		ID: uuid.New(), Day: day, Name: op.Name, CreatedAt: now,
		Before: orEmpty(record.Before), After: orEmpty(record.After), Readied: orEmpty(marks),
		LanesBefore: orEmpty(record.LanesBefore), LanesAfter: orEmpty(record.LanesAfter),
	}
	if err := tx.Create(&rec).Error; err != nil {
		return "", nil, err
	}
	return rec.ID.String(), readied, nil
}

// undo は記録した操作を取り消す（「1つ戻す」）。
// 操作のあと、関係するカードと注文が誰にも触られていないことを全部確かめてから戻す。1 つでも違えば caos.ErrInvalid（何も変えない）。
func (s *CaosStore) undo(tx *gorm.DB, day string, b *caos.Board, cs *caos.Changeset, opID string) ([]string, error) {
	id, err := uuid.Parse(opID)
	if err != nil {
		return nil, caosInvalid("戻す操作が見つかりません")
	}
	var rec models.CaosOpRow
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&rec, "id = ? AND day = ?", id, day).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, caosInvalid("戻す操作が見つかりません")
		}
		return nil, err
	}
	if rec.UndoneAt != nil {
		return nil, caosInvalid("この操作はもう元に戻しています")
	}
	// この操作で付けた準備完了が、そのまま残っているか（ほかの端末で外した・付け直した・提供済みにした、なら戻さない）
	for _, m := range rec.Readied {
		var o models.Order
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&o, "id = ?", m.OrderID).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, caosInvalid("注文が消されたため、元に戻せません")
			}
			return nil, err
		}
		if o.ServedAt != nil {
			return nil, caosInvalid("提供済みの注文があるため、元に戻せません")
		}
		if o.ReadyAt == nil || !o.ReadyAt.Equal(m.ReadyAt) {
			return nil, caosInvalid("ほかの端末で変更されたため、元に戻せません")
		}
	}
	// この操作で付けた準備完了は、このあと外すので、カードを戻すときの確かめでは外した状態として扱う
	for _, m := range rec.Readied {
		if o, ok := b.Orders[m.OrderID]; ok {
			o.Ready = false
		}
	}
	// 列の担当者とカード：記録のあと誰も触っていなければ、記録の中身で戻す（確かめてから変える。練習用の盤面と同じ Board.Undo）
	if err := b.Undo(cs, caos.OpRecord{Before: rec.Before, After: rec.After, LanesBefore: rec.LanesBefore, LanesAfter: rec.LanesAfter}); err != nil {
		return nil, err
	}
	now := s.clock()
	var unreadied []string
	for _, m := range rec.Readied {
		if _, _, err := setOrderReady(tx, uuid.MustParse(m.OrderID), false, now); err != nil {
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
func (s *CaosStore) readyAll(tx *gorm.DB, ids []string) ([]string, error) {
	now := s.clock()
	var readied []string
	for _, id := range ids {
		_, changed, err := setOrderReady(tx, uuid.MustParse(id), true, now)
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

func caosInvalid(msg string) error { return &caos.InvalidError{Message: msg} }

func orEmpty[T any](v []T) []T {
	if v == nil {
		return []T{}
	}
	return v
}

// Drips はその日の全カード（配信に使う）。
func (s *CaosStore) Drips(day string) ([]caos.Drip, error) { return readCaosDrips(s.db, day) }

// Lanes はその日の 1〜6 の全部の列の担当者（配信に使う）。担当者のいない列は名前が空。
func (s *CaosStore) Lanes(day string) ([]caos.Lane, error) {
	lanes, err := readCaosLanes(s.db, day)
	if err != nil {
		return nil, err
	}
	b := caos.NewBoard(nil, nil, nil, nil)
	b.LoadLanes(lanes)
	return b.Lanes(), nil
}

// Today は画面からの操作を行う日（日本時間の今日）。
func (s *CaosStore) Today() string { return s.today() }

// OrdersChanged は POS で注文が作られた・変わった・消えたときに、その注文のカードをそろえる。注文のハンドラーの tx の中で呼ぶ。
// POS で準備完了にした注文と統合していた相手の注文も、それでカードが全部終わったなら、同じ tx で準備完了にする。
// そうして準備完了にした注文を返す（ハンドラーが画面へ配る）。
func (s *CaosStore) OrdersChanged(tx *gorm.DB, refs []caosOrderRef) ([]uuid.UUID, error) {
	byDay := map[string][]uuid.UUID{}
	var days []string
	for _, r := range refs {
		day := caos.Day(r.CreatedAt)
		if _, ok := byDay[day]; !ok {
			days = append(days, day)
		}
		byDay[day] = append(byDay[day], r.ID)
	}
	var readied []uuid.UUID
	for _, day := range days {
		ids := byDay[day]
		_, cs, err := s.withBoard(tx, day, func(tx *gorm.DB, b *caos.Board, cs *caos.Changeset) error {
			// 注文はロックを取ったあとに読む（その間に消された・変わった注文で、カードを作り直さないように）
			var orders []models.Order
			if err := preloadCaosOrderLines(tx).Where("id IN ?", ids).Find(&orders).Error; err != nil {
				return err
			}
			found := map[string]bool{}
			for _, o := range orders {
				found[o.ID.String()] = true
			}
			b.IngestOrders(cs, toCaosOrders(orders), false)
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
func preloadCaosOrderLines(db *gorm.DB) *gorm.DB {
	unscoped := func(db *gorm.DB) *gorm.DB { return db.Unscoped() }
	return db.Preload("OrderMenus.Menu", unscoped).
		Preload("OrderMenus.Menu.MenuItems").
		Preload("OrderMenus.Menu.MenuItems.Item", unscoped).
		Preload("OrderMenus.Menu.MenuItems.Item.ItemType", unscoped).
		Preload("OrderCups", func(db *gorm.DB) *gorm.DB { return db.Order("order_cups.position") }).
		Preload("OrderCups.Item", unscoped).
		Preload("OrderCups.Item.ItemType", unscoped)
}

func toCaosOrders(orders []models.Order) []caos.Order {
	out := make([]caos.Order, 0, len(orders))
	for _, o := range orders {
		order := caos.Order{ID: o.ID.String(), OrderNo: o.OrderId, CreatedAt: o.CreatedAt, Ready: o.ReadyAt != nil, Served: o.ServedAt != nil}
		cups := map[uuid.UUID][]models.OrderCup{}
		for _, cup := range o.OrderCups {
			cups[cup.OrderMenuID] = append(cups[cup.OrderMenuID], cup)
		}
		for _, line := range o.OrderMenus {
			if len(cups[line.ID]) == 0 {
				for _, mi := range line.Menu.MenuItems {
					order.Lines = append(order.Lines, caos.OrderLine{
						Dripper: line.Dripper, ItemID: mi.Item.ID.String(), Name: mi.Item.Name, Abbr: mi.Item.Abbr,
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
				order.Lines = append(order.Lines, caos.OrderLine{
					Dripper: line.Dripper, ItemID: cup.ItemID.String(), Name: cup.Item.Name, Abbr: cup.Item.Abbr,
					Type: cup.Item.ItemType.Name, Quantity: 1,
				})
			}
		}
		out = append(out, order)
	}
	slices.SortFunc(out, func(a, b caos.Order) int { return a.CreatedAt.Compare(b.CreatedAt) })
	return out
}
