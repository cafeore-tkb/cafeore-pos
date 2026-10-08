package handlers

import (
	"errors"
	"log"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// CaOS（ドリップ管制）の盤面の読み書き・API・配信。盤面の決まり（組み立て・操作）は caos パッケージ（DB を使わない）にある。
//
//   - 表：caos_drips（カードの情報だけ。models.CaosDrip）と caos_ops（操作の記録。models.CaosOpRecord）。
//     カードの中身はカップ（order_cups の drip_id・emergency_at・emergency_drip_id）が持つ
//   - 注文の作成・編集・削除では CaOS のために何も書かない。盤面は読むたびに今のカップから組み立てる（caos.Board.Normalize・Cards）
//   - 操作（POST /api/caos/ops）は、その日の advisory lock で 1 件ずつ行い、カップを書くときは注文の行をロックしてから
//     （注文の編集・カップの準備完了と同じ順番）、読んだときから変わっていないかを確かめる。変わっていたら最初からやり直す
//   - 配信：/api/ws/orders の {"type":"drips"}。操作のたびと、注文が変わったとき（Hub.RequestBoard）に今日の盤面を全部配る。
//     ほかのインスタンスへは DB の通知（caosBoardChangedChannel）で知らせる

// 盤面が変わったことをインスタンス同士で知らせる DB の通知チャンネル。通知の中身は "<送ったインスタンスの ID>"
const caosBoardChangedChannel = "caos_board_changed"

// 注文と重なって書けなかったときに、最初からやり直す回数
const caosAttempts = 3

// 読んだあとに注文の側でカップが変わっていた（注文の編集・削除・カップの準備完了と重なった）
var errCaosConflict = errors.New("caos: cups changed while applying the op")

type CaosHandler struct {
	db  *gorm.DB
	hub *Hub
	// 今の時刻（テストで差し替える）。盤面の日付と操作の時刻に使う
	now func() time.Time
}

func NewCaosHandler(db *gorm.DB, hub *Hub) *CaosHandler {
	return &CaosHandler{db: db, hub: hub, now: time.Now}
}

// ---------------------------------------------------------------- 読む

// 盤面のカップ 1 杯（注文番号・商品・指名と一緒に読む）。
type caosCupRow struct {
	ID              uuid.UUID
	OrderID         uuid.UUID
	OrderNo         int
	Position        int
	ItemID          uuid.UUID
	ItemName        string
	ItemType        string
	Assignee        *string
	ReadyAt         *time.Time
	ServedAt        *time.Time
	DripID          *uuid.UUID
	EmergencyAt     *time.Time
	EmergencyDripID *uuid.UUID
}

// loadCaosBoard はその日の盤面（保存したカードと、その日の注文のカップ）を読む。
// 販売終了（論理削除）した商品・種類のカップも読む。
func loadCaosBoard(tx *gorm.DB, day string) (caos.Board, error) {
	start, end, err := caos.DayRange(day)
	if err != nil {
		return caos.Board{}, err
	}
	var rows []caosCupRow
	if err := tx.Raw(`
		SELECT c.id, c.order_id, o.order_id AS order_no, c.position, c.item_id,
			COALESCE(i.name, '') AS item_name, COALESCE(t.name, '') AS item_type, m.assignee,
			c.ready_at, c.served_at, c.drip_id, c.emergency_at, c.emergency_drip_id
		FROM order_cups c
		JOIN orders o ON o.id = c.order_id
		LEFT JOIN order_menus m ON m.id = c.order_menu_id
		LEFT JOIN items i ON i.id = c.item_id
		LEFT JOIN item_types t ON t.id = i.item_type_id
		WHERE o.created_at >= ? AND o.created_at < ?`, start, end).Scan(&rows).Error; err != nil {
		return caos.Board{}, err
	}
	var drips []models.CaosDrip
	if err := tx.Where("day = ?", day).Find(&drips).Error; err != nil {
		return caos.Board{}, err
	}
	b := caos.Board{Cups: make([]caos.Cup, len(rows)), Drips: make([]caos.Drip, len(drips))}
	for i, r := range rows {
		var nominee *string
		if r.Assignee != nil {
			if s := strings.TrimSpace(*r.Assignee); s != "" {
				nominee = &s
			}
		}
		b.Cups[i] = caos.Cup{
			ID: r.ID, OrderID: r.OrderID, OrderNo: r.OrderNo, Position: r.Position,
			ItemID: r.ItemID, ItemName: r.ItemName, ItemType: r.ItemType, Nominee: nominee,
			ReadyAt: r.ReadyAt, ServedAt: r.ServedAt,
			DripID: r.DripID, EmergencyAt: r.EmergencyAt, EmergencyDripID: r.EmergencyDripID,
		}
	}
	for i, d := range drips {
		b.Drips[i] = caos.Drip{
			ID: d.ID, Lane: d.Lane, Position: d.Position, Status: d.Status, Emergency: d.Emergency,
			Interrupted: d.Interrupted, StartedAt: d.StartedAt, FinishedAt: d.FinishedAt, CreatedAt: d.CreatedAt,
		}
	}
	return b, nil
}

// BoardMessage は今日の盤面を WSMessage にする（接続したときと、配り直すとき）。
func (h *CaosHandler) BoardMessage() (WSMessage, error) {
	b, err := loadCaosBoard(h.db, caos.Day(h.now()))
	if err != nil {
		return WSMessage{}, err
	}
	b.Normalize()
	return WSMessage{Type: WSMessageTypeDrips, Drips: b.Cards()}, nil
}

// ---------------------------------------------------------------- 書く

// saveCaosChange は盤面の変わったところを保存する。カップの準備完了が変わった注文を返す（画面へ配る）。
//
// カードの行は、1 つの列で抽出中が 1 枚の索引に書き換えの途中で引っかからないよう、変わった行をいったん消してから入れ直す。
// カップは注文ごとに、注文の行をロックしてから今の値が ch.Before と同じかを確かめて書く（違えば errCaosConflict）。
// 準備完了が変わったら、POS のカップの準備完了と同じく注文の状態をカップから決め直す（syncOrderWithCups）。
func saveCaosChange(tx *gorm.DB, day string, ch caos.Change) ([]uuid.UUID, error) {
	if len(ch.Drips) > 0 {
		ids := make([]uuid.UUID, len(ch.Drips))
		var rows []models.CaosDrip
		for i, dc := range ch.Drips {
			ids[i] = dc.ID
			if d := dc.After; d != nil {
				rows = append(rows, models.CaosDrip{
					ID: d.ID, Day: day, Lane: d.Lane, Position: d.Position, Status: d.Status, Emergency: d.Emergency,
					Interrupted: d.Interrupted, StartedAt: d.StartedAt, FinishedAt: d.FinishedAt, CreatedAt: d.CreatedAt,
				})
			}
		}
		if err := tx.Where("id IN ?", ids).Delete(&models.CaosDrip{}).Error; err != nil {
			return nil, err
		}
		if len(rows) > 0 {
			if err := tx.Create(&rows).Error; err != nil {
				return nil, err
			}
		}
	}

	// 注文の ID の順にロックする（ほかの操作と同じ順にして、待ち合いで止まらないようにする）
	byOrder := map[uuid.UUID][]caos.CupChange{}
	var orderIDs []uuid.UUID
	for _, cc := range ch.Cups {
		if _, ok := byOrder[cc.OrderID]; !ok {
			orderIDs = append(orderIDs, cc.OrderID)
		}
		byOrder[cc.OrderID] = append(byOrder[cc.OrderID], cc)
	}
	slices.SortFunc(orderIDs, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	var readied []uuid.UUID
	for _, orderID := range orderIDs {
		order, err := lockOrderWith(tx, orderID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, errCaosConflict
		}
		if err != nil {
			return nil, err
		}
		before := order
		before.OrderCups = append([]models.OrderCup(nil), order.OrderCups...)
		readyChanged := false
		for _, cc := range byOrder[orderID] {
			cup := findOrderCup(&order, cc.ID)
			if cup == nil || !cupMarks(cup).Equal(cc.Before) {
				return nil, errCaosConflict
			}
			readyChanged = readyChanged || !timeEqual(cc.Before.ReadyAt, cc.After.ReadyAt)
			cup.DripID, cup.EmergencyAt, cup.EmergencyDripID = cc.After.DripID, cc.After.EmergencyAt, cc.After.EmergencyDripID
			cup.ReadyAt, cup.ServedAt = cc.After.ReadyAt, cc.After.ServedAt
			if err := tx.Model(&models.OrderCup{}).Where("id = ?", cup.ID).Updates(map[string]any{
				"drip_id":           cup.DripID,
				"emergency_at":      cup.EmergencyAt,
				"emergency_drip_id": cup.EmergencyDripID,
				"ready_at":          cup.ReadyAt,
				"served_at":         cup.ServedAt,
			}).Error; err != nil {
				return nil, err
			}
		}
		if !readyChanged {
			continue
		}
		syncOrderWithCups(&order)
		// カップは上で書いたので、注文の状態だけを書く（saveOrderStatus はカップの変わっていない行を飛ばす）
		before.OrderCups = order.OrderCups
		if err := saveOrderStatus(tx, &before, &order); err != nil {
			return nil, err
		}
		readied = append(readied, orderID)
	}
	return readied, nil
}

func cupMarks(c *models.OrderCup) caos.CupMarks {
	return caos.CupMarks{DripID: c.DripID, EmergencyAt: c.EmergencyAt, EmergencyDripID: c.EmergencyDripID, ReadyAt: c.ReadyAt, ServedAt: c.ServedAt}
}

// ---------------------------------------------------------------- 操作

// 操作の結果
type caosApplied struct {
	opID *uuid.UUID
	// カップの準備完了が変わった注文
	orders []uuid.UUID
	// 盤面が変わったか（変わらなければ配らない）
	changed bool
}

// apply は今日の盤面に操作を 1 つ行う。全部を 1 つのトランザクションで行う：
//  1. その日の advisory lock を取り、盤面を読み、注文の側で変わったこと（消えたカップ・マスターでの準備完了）をカードに写して保存する
//  2. 操作（undo なら記録で戻す）を行い、変わったところを保存する
//  3. 操作の記録（caos_ops）を残す
func (h *CaosHandler) apply(op caos.Op, undoID uuid.UUID) (caosApplied, error) {
	now := h.now().Truncate(time.Microsecond) // DB に保存される精度にそろえ、記録した値と読み直した値を比べられるようにする
	day := caos.Day(now)
	var res caosApplied
	err := h.db.Transaction(func(tx *gorm.DB) error {
		res = caosApplied{}
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "caos:"+day).Error; err != nil {
			return err
		}
		b, err := loadCaosBoard(tx, day)
		if err != nil {
			return err
		}
		read := b.Clone()
		b.Normalize()
		if ch := caos.Diff(&read, &b); !ch.Empty() {
			if _, err := saveCaosChange(tx, day, ch); err != nil {
				return err
			}
			res.changed = true
		}

		base := b.Clone()
		var rec *models.CaosOpRecord
		if op.Name == caos.OpUndo {
			rec = &models.CaosOpRecord{}
			err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(rec, "id = ? AND day = ?", undoID, day).Error
			switch {
			case errors.Is(err, gorm.ErrRecordNotFound):
				return &caos.InvalidError{Message: "戻す操作が見つかりません"}
			case err != nil:
				return err
			case rec.UndoneAt != nil:
				return &caos.InvalidError{Message: "この操作はもう元に戻しています"}
			}
			if err := b.Revert(rec.Change); err != nil {
				return err
			}
		} else if err := b.Apply(op, now, uuid.New); err != nil {
			return err
		}

		ch := caos.Diff(&base, &b)
		orders, err := saveCaosChange(tx, day, ch)
		if err != nil {
			return err
		}
		res.orders = orders
		res.changed = res.changed || !ch.Empty()
		if rec != nil {
			return tx.Model(rec).Update("undone_at", now).Error
		}
		if ch.Empty() {
			return nil
		}
		record := models.CaosOpRecord{ID: uuid.New(), Day: day, Name: op.Name, Change: ch, CreatedAt: now}
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		res.opID = &record.ID
		return nil
	})
	return res, err
}

// POST /api/caos/ops - 今日の盤面への操作（割当・未割当に戻す・次へ・統合・緊急・1つ戻す）
func (h *CaosHandler) ApplyCaosOp(c *gin.Context) {
	var req models.CaosOp
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	op, undoID, err := toCaosOp(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var res caosApplied
	for range caosAttempts {
		res, err = h.apply(op, undoID)
		if !errors.Is(err, errCaosConflict) {
			break
		}
	}
	switch {
	case caos.IsInvalid(err):
		// ルールに合わない操作は 422（理由をそのまま画面に出す）
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	case errors.Is(err, errCaosConflict):
		c.JSON(http.StatusConflict, gin.H{"error": "注文の変更と重なりました。もう一度押してください"})
		return
	case err != nil:
		log.Printf("caos: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, models.CaosOpResult{OpId: res.opID})
	h.publish(res)
}

// publish は操作のあとに、盤面と準備完了の変わった注文を画面へ配り、ほかのインスタンスへ知らせる。
func (h *CaosHandler) publish(res caosApplied) {
	for _, id := range res.orders {
		// 注文の配信が盤面の配り直しも頼む（Hub.RequestBoard）
		if _, err := publishOrder(h.db, h.hub, id); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("caos: failed to publish order %s: %v", id, err)
		}
	}
	if res.changed {
		h.hub.RequestBoard()
		notifyChanged(h.db, caosBoardChangedChannel, instanceID)
	}
}

var errCaosRequest = errors.New("invalid caos op")

// toCaosOp は API のリクエストを caos.Op にする。undo なら戻す操作の ID も返す。
func toCaosOp(req models.CaosOp) (caos.Op, uuid.UUID, error) {
	op := caos.Op{Name: string(req.Name), Card: toCardRef(req.Card), With: toCardRef(req.With), Index: req.Index}
	if req.Lane != nil {
		op.Lane = *req.Lane
	}
	if req.CupIds != nil {
		for _, id := range *req.CupIds {
			op.CupIDs = append(op.CupIDs, uuid.UUID(id))
		}
	}
	if req.Interrupt != nil {
		op.Interrupt = *req.Interrupt
	}
	if op.Name == caos.OpUndo {
		if req.OpId == nil {
			return op, uuid.Nil, errCaosRequest
		}
		return op, uuid.UUID(*req.OpId), nil
	}
	return op, uuid.Nil, nil
}

func toCardRef(ref *models.CaosCardRef) *caos.CardRef {
	if ref == nil {
		return nil
	}
	out := &caos.CardRef{}
	if ref.Id != nil {
		id := uuid.UUID(*ref.Id)
		out.ID = &id
	}
	if ref.CupIds != nil {
		for _, id := range *ref.CupIds {
			out.CupIDs = append(out.CupIDs, uuid.UUID(id))
		}
	}
	return out
}
