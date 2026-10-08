package handlers

import (
	"cmp"
	"errors"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// 緊急（入れ直し）。カップに印を付けるだけで、入れ直しのカードは CaOS の未割当のいちばん上に出る（画面が組み立てる）。
//
//   - POST /api/caos/emergency：カップを緊急にする（マスターの緊急ボタンと CaOS の入れ直しのパネル）。
//     emergency_at を付けるだけで、最初の抽出の列（dripper・dripper_position・drip_id・brew_started_at・brew_finished_at）は残す。
//     入れ直しのカードは別の列（emergency_dripper・emergency_dripper_position・emergency_drip_id・emergency_brew_started_at・
//     emergency_brew_finished_at）で持つ（caosCol）
//   - POST /api/orders/:id/cups/:cupId/emergency-label/claim・release：緊急のシールを印刷する役を取る・返す。
//     プリンターにつないだレジが、emergency_printed_at を「まだ空なら付ける」で付けられたときだけ印刷する（2 重に印刷しない）
//
// どれも注文の行をロックしてから書く（注文の編集がカップを入れ直すのと重ならないように）。

// caosCol はカップの CaOS のカードの列 col（dripper・dripper_position・drip_id・brew_started_at・brew_finished_at）の SQL
// （alias はテーブルの別名。空なら付けない）。緊急のカップは入れ直しの列（emergency_<col>）、それ以外は最初の抽出の列。
func caosCol(alias, col string) string {
	p := ""
	if alias != "" {
		p = alias + "."
	}
	return "(CASE WHEN " + p + "emergency_at IS NULL THEN " + p + col + " ELSE " + p + "emergency_" + col + " END)"
}

// caosCardSQL はカップの CaOS のカードの SQL（緊急のカップは入れ直しのカード emergency_drip_id）。
func caosCardSQL(alias string) string { return caosCol(alias, "drip_id") }

// caosCardID はカップの CaOS のカード（caosCardSQL と同じ）。
func caosCardID(c *models.OrderCup) *uuid.UUID { return cupCaosState(c).DripID }

// whereCaosCard はカードが id のカップに絞る。
func whereCaosCard(tx *gorm.DB, id uuid.UUID) *gorm.DB {
	return tx.Where(caosCardSQL("")+" = ?", id)
}

// updateCaosCups はカップに CaOS の値を書く。緊急のカップは入れ直しの列に、それ以外は最初の抽出の列に書く。
func updateCaosCups(tx *gorm.DB, cups []uuid.UUID, s caosState) error {
	if err := tx.Model(&models.OrderCup{}).Where("id IN ? AND emergency_at IS NULL", cups).Updates(s.updates(false)).Error; err != nil {
		return err
	}
	return tx.Model(&models.OrderCup{}).Where("id IN ? AND emergency_at IS NOT NULL", cups).Updates(s.updates(true)).Error
}

// updateCaosCard はカード id のカップの列 col を value にする（入れ直しのカードなら入れ直しの列 emergency_<col>）。
func updateCaosCard(tx *gorm.DB, id uuid.UUID, col string, value any) error {
	if err := tx.Model(&models.OrderCup{}).Where("emergency_at IS NULL AND drip_id = ?", id).Update(col, value).Error; err != nil {
		return err
	}
	return tx.Model(&models.OrderCup{}).Where("emergency_at IS NOT NULL AND emergency_drip_id = ?", id).Update("emergency_"+col, value).Error
}

// finishCaosCard はカードの抽出を終える（brew_finished_at）。抽出中に緊急にしたカップ（中断せず、カードの残りのカップを
// 淹れ続けたとき）の最初の抽出も、カードといっしょに終える（最初の抽出の列がカードのほかのカップとそろう）。
func finishCaosCard(tx *gorm.DB, id uuid.UUID, now time.Time) error {
	if err := updateCaosCard(tx, id, "brew_finished_at", now); err != nil {
		return err
	}
	return tx.Model(&models.OrderCup{}).
		Where("emergency_at IS NOT NULL AND drip_id = ? AND brew_started_at IS NOT NULL AND brew_finished_at IS NULL", id).
		Update("brew_finished_at", now).Error
}

// ---------------------------------------------------------------- POST /api/caos/emergency

type caosEmergencyResult struct {
	marked      []uuid.UUID
	interrupted []uuid.UUID
	started     []uuid.UUID
	orderIDs    []uuid.UUID
}

// 緊急にするときに読むカップ
type caosEmergencyCup struct {
	ID             uuid.UUID
	OrderID        uuid.UUID
	Dripper        *int
	DripID         *uuid.UUID // カード（caosCardSQL）
	BrewStartedAt  *time.Time
	BrewFinishedAt *time.Time
	EmergencyAt    *time.Time
	Brew           bool
}

func (c caosEmergencyCup) brewing() bool { return c.BrewStartedAt != nil && c.BrewFinishedAt == nil }

func readEmergencyCups(tx *gorm.DB, where string, args ...any) ([]caosEmergencyCup, error) {
	var rows []caosEmergencyCup
	err := tx.Raw(`
		SELECT c.id, c.order_id, `+caosCol("c", "dripper")+` AS dripper, `+caosCardSQL("c")+` AS drip_id,
			`+caosCol("c", "brew_started_at")+` AS brew_started_at, `+caosCol("c", "brew_finished_at")+` AS brew_finished_at, c.emergency_at,
			COALESCE(t.makes_cup, true) AND COALESCE(t.needs_brew, true) AS brew
		FROM order_cups c
		LEFT JOIN items i ON i.id = c.item_id
		LEFT JOIN item_types t ON t.id = i.item_type_id
		WHERE `+where, args...).Scan(&rows).Error
	return rows, err
}

// readCaosLane はドリッパーの抽出中と待機のカードを読む（終わりとみなすカードは除く）。待機は「次へ」で始める順。
// 「次へ」（caos.go の advance）が読むのと同じ読み方（中断のあとに始める待機の先頭を決める）。
func readCaosLane(tx *gorm.DB, dripper int, start, end time.Time) (brewing, queued []*caosLaneCard, err error) {
	var rows []caosLaneCup
	if err := tx.Raw(`
		SELECT c.id, c.order_id, o.order_id AS order_no, `+caosCardSQL("c")+` AS drip_id,
			`+caosCol("c", "dripper_position")+` AS dripper_position, `+caosCol("c", "brew_started_at")+` AS brew_started_at,
			`+caosCol("c", "brew_finished_at")+` AS brew_finished_at, c.ready_at, c.emergency_at
		FROM order_cups c JOIN orders o ON o.id = c.order_id
		WHERE o.created_at >= ? AND o.created_at < ? AND `+caosCol("c", "dripper")+` = ? AND `+caosCol("c", "brew_finished_at")+` IS NULL`,
		start, end, dripper).Scan(&rows).Error; err != nil {
		return nil, nil, err
	}
	byID := map[uuid.UUID]*caosLaneCard{}
	for _, r := range rows {
		if r.DripID == nil {
			continue
		}
		card, ok := byID[*r.DripID]
		if !ok {
			card = &caosLaneCard{dripID: *r.DripID, orderNo: r.OrderNo}
			byID[*r.DripID] = card
			if r.BrewStartedAt != nil {
				brewing = append(brewing, card)
			} else {
				queued = append(queued, card)
			}
		}
		card.cups = append(card.cups, r)
		card.orderNo = min(card.orderNo, r.OrderNo)
	}
	done := func(c *caosLaneCard) bool { return c.done() }
	brewing = slices.DeleteFunc(brewing, done)
	queued = slices.DeleteFunc(queued, done)
	slices.SortFunc(queued, func(a, b *caosLaneCard) int {
		return cmp.Or(
			cmp.Compare(a.position(), b.position()),
			cmp.Compare(a.orderNo, b.orderNo),
			strings.Compare(a.dripID.String(), b.dripID.String()),
		)
	})
	return brewing, queued, nil
}

// markEmergency はカップを緊急にする。interrupt なら、カップの抽出中のカードのカップを全部緊急にする。
// 抽出中のカードのカップが全部緊急になったら（中断）、そのドリッパーの待機の先頭を始める。
func (h *CaosHandler) markEmergency(cupIDs []uuid.UUID, interrupt bool) (caosEmergencyResult, error) {
	now := h.now().Truncate(time.Millisecond)
	start, end := caosToday(now)
	var res caosEmergencyResult
	err := h.db.Transaction(func(tx *gorm.DB) error {
		res = caosEmergencyResult{}
		cups, err := readEmergencyCups(tx, "c.id IN ?", cupIDs)
		if err != nil {
			return err
		}
		if len(cups) != len(cupIDs) {
			return caosConflict("カップが消えました（注文が編集・削除されたかもしれません）")
		}
		if interrupt {
			// 中断できるのは 1 枚の抽出中のカード。そのカードのカップを全部緊急にする
			card := cups[0].DripID
			for _, c := range cups {
				if c.EmergencyAt != nil || !c.brewing() || c.DripID == nil || !ptrEqual(c.DripID, card) {
					return caosRule("中断できるのは 1 枚の抽出中のカードのカップだけです")
				}
			}
			if cups, err = readEmergencyCups(tx, caosCardSQL("c")+" = ?", *card); err != nil {
				return err
			}
		}
		// もう緊急のカップは何もしない
		cups = slices.DeleteFunc(cups, func(c caosEmergencyCup) bool { return c.EmergencyAt != nil })
		for _, c := range cups {
			if !c.Brew {
				return caosRule("抽出の要らないカップは緊急にできません")
			}
		}
		if len(cups) == 0 {
			return nil
		}

		// 抽出中のカードのうち、カップが全部緊急になるもの（中断）。ドリッパーの待機の先頭を始める
		marking := map[uuid.UUID]bool{}
		for _, c := range cups {
			marking[c.ID] = true
		}
		ending := map[uuid.UUID]int{} // カード → ドリッパー
		for _, c := range cups {
			if !c.brewing() || c.DripID == nil || c.Dripper == nil {
				continue
			}
			if _, ok := ending[*c.DripID]; ok {
				continue
			}
			mates, err := readEmergencyCups(tx, caosCardSQL("c")+" = ?", *c.DripID)
			if err != nil {
				return err
			}
			if !slices.ContainsFunc(mates, func(m caosEmergencyCup) bool { return !marking[m.ID] }) {
				ending[*c.DripID] = *c.Dripper
			}
		}
		var drippers []int
		for _, d := range ending {
			drippers = append(drippers, d)
		}
		if err := lockCaosDrippers(tx, drippers); err != nil {
			return err
		}
		// 中断のあとに始める待機の先頭（ドリッパーのロックの中で読む）。
		// 中断するのは、本当に抽出中のカード（準備完了で終わりとみなすカードでない）だけ。
		// ほかに抽出中のカードがあるドリッパーでは始めない
		var heads []*caosLaneCard
		interrupted := map[uuid.UUID]bool{}
		for _, d := range uniqueInts(drippers) {
			brewing, queued, err := readCaosLane(tx, d, start, end)
			if err != nil {
				return err
			}
			others := 0
			for _, card := range brewing {
				if d2, ok := ending[card.dripID]; ok && d2 == d {
					interrupted[card.dripID] = true
				} else {
					others++
				}
			}
			if others == 0 && len(brewing) > 0 && len(queued) > 0 {
				heads = append(heads, queued[0])
			}
		}

		var orderIDs []uuid.UUID
		for _, c := range cups {
			orderIDs = append(orderIDs, c.OrderID)
		}
		for _, head := range heads {
			for _, cup := range head.cups {
				orderIDs = append(orderIDs, cup.OrderID)
			}
		}
		orders, err := lockCaosOrders(tx, orderIDs, start, end)
		if err != nil {
			return err
		}
		// ロックする前に読んだカップが、そのままか（違えば読み直す）
		for _, c := range cups {
			_, cup := findCaosCup(orders, c.ID)
			if cup == nil || cup.EmergencyAt != nil {
				return errCaosConflict
			}
			if s := cupCaosState(cup); !ptrEqual(s.Dripper, c.Dripper) || !ptrEqual(s.DripID, c.DripID) ||
				!msEqual(s.BrewStartedAt, c.BrewStartedAt) || !msEqual(s.BrewFinishedAt, c.BrewFinishedAt) {
				return errCaosConflict
			}
		}
		for _, head := range heads {
			for _, r := range head.cups {
				_, cup := findCaosCup(orders, r.ID)
				if cup == nil {
					return errCaosConflict
				}
				if s := cupCaosState(cup); !ptrEqual(s.DripID, r.DripID) || s.BrewStartedAt != nil || s.BrewFinishedAt != nil ||
					!timeEqual(cup.ReadyAt, r.ReadyAt) {
					return errCaosConflict
				}
			}
		}

		for _, c := range cups {
			res.marked = append(res.marked, c.ID)
		}
		// 最初の抽出の列は残す（中断したカードのカップは、始めた時刻だけが残る）。入れ直しのカードは未割当から
		marked := (caosState{}).updates(true)
		marked["emergency_at"] = now
		marked["emergency_printed_at"] = nil
		if err := tx.Model(&models.OrderCup{}).Where("id IN ?", res.marked).Updates(marked).Error; err != nil {
			return err
		}
		for id := range interrupted {
			res.interrupted = append(res.interrupted, id)
		}
		for _, head := range heads {
			if err := updateCaosCard(tx, head.dripID, "brew_started_at", now); err != nil {
				return err
			}
			res.started = append(res.started, head.dripID)
		}
		for id := range orders {
			res.orderIDs = append(res.orderIDs, id)
		}
		return nil
	})
	return res, err
}

func apiUUIDs(ids []uuid.UUID) []openapi_types.UUID {
	out := make([]openapi_types.UUID, len(ids))
	for i, id := range ids {
		out[i] = openapi_types.UUID(id)
	}
	return out
}

// POST /api/caos/emergency - カップを緊急（入れ直し）にする
func (h *CaosHandler) MarkCaosEmergency(c *gin.Context) {
	var req models.CaosEmergencyRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if len(req.CupIds) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "cup_ids が空です"})
		return
	}
	cupIDs := make([]uuid.UUID, 0, len(req.CupIds))
	for _, id := range req.CupIds {
		if !slices.Contains(cupIDs, uuid.UUID(id)) {
			cupIDs = append(cupIDs, uuid.UUID(id))
		}
	}
	var res caosEmergencyResult
	var err error
	for range caosAttempts {
		res, err = h.markEmergency(cupIDs, req.Interrupt)
		// ロックする前に読んだカップが変わっていた（注文の編集・CaOS の操作と重なった）ときだけ読み直す
		if err != errCaosConflict {
			break
		}
	}
	if err == errCaosConflict {
		err = caosConflict("注文の変更と重なりました。もう一度押してください")
	}
	if respondCaosError(c, err) {
		return
	}
	c.JSON(http.StatusOK, models.CaosEmergencyResult{
		MarkedCupIds:       apiUUIDs(res.marked),
		InterruptedDripIds: apiUUIDs(res.interrupted),
		StartedDripIds:     apiUUIDs(res.started),
	})
	h.publish(res.orderIDs)
}

// ---------------------------------------------------------------- 緊急のシール

// claimEmergencyLabel は、緊急でまだ印刷していないカップに、印刷した時刻（サーバーの今）を付ける。
// 付けられたら true（このレジが印刷する）。付けられなければ false と今の値。
func (h *CaosHandler) claimEmergencyLabel(orderID, cupID uuid.UUID) (bool, *time.Time, error) {
	now := h.now().Truncate(time.Millisecond)
	claimed := false
	var printedAt *time.Time
	err := h.db.Transaction(func(tx *gorm.DB) error {
		// 注文の編集（カップを消して入れ直す）が、付ける前の値で入れ直さないよう、注文の行を先にロックする
		order, err := lockOrderWith(tx, orderID)
		if err != nil {
			return err
		}
		cup := findOrderCup(&order, cupID)
		if cup == nil {
			return gorm.ErrRecordNotFound
		}
		result := tx.Model(&models.OrderCup{}).
			Where("id = ? AND emergency_at IS NOT NULL AND emergency_printed_at IS NULL", cupID).
			Update("emergency_printed_at", now)
		if result.Error != nil {
			return result.Error
		}
		claimed = result.RowsAffected == 1
		printedAt = cup.EmergencyPrintedAt
		if claimed {
			printedAt = &now
		}
		return nil
	})
	return claimed, printedAt, err
}

// releaseEmergencyLabel は、印刷した時刻が at のままなら空に戻す（印刷に失敗した）。戻せたら true。
func (h *CaosHandler) releaseEmergencyLabel(orderID, cupID uuid.UUID, at time.Time) (bool, error) {
	released := false
	err := h.db.Transaction(func(tx *gorm.DB) error {
		order, err := lockOrderWith(tx, orderID)
		if err != nil {
			return err
		}
		cup := findOrderCup(&order, cupID)
		if cup == nil {
			return gorm.ErrRecordNotFound
		}
		if cup.EmergencyPrintedAt == nil || !msEqual(cup.EmergencyPrintedAt, &at) {
			return nil
		}
		released = true
		return tx.Model(&models.OrderCup{}).Where("id = ?", cupID).Update("emergency_printed_at", nil).Error
	})
	return released, err
}

func orderCupParams(c *gin.Context) (uuid.UUID, uuid.UUID, bool) {
	orderID, err1 := uuid.Parse(c.Param("id"))
	cupID, err2 := uuid.Parse(c.Param("cupId"))
	if err1 != nil || err2 != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return uuid.Nil, uuid.Nil, false
	}
	return orderID, cupID, true
}

func respondNotFoundOr500(c *gin.Context, err error) {
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order or cup not found"})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
}

// POST /api/orders/:id/cups/:cupId/emergency-label/claim - 緊急のシールを印刷する役を取る
func (h *CaosHandler) ClaimEmergencyLabel(c *gin.Context) {
	orderID, cupID, ok := orderCupParams(c)
	if !ok {
		return
	}
	claimed, printedAt, err := h.claimEmergencyLabel(orderID, cupID)
	if err != nil {
		respondNotFoundOr500(c, err)
		return
	}
	c.JSON(http.StatusOK, models.EmergencyLabelClaim{Claimed: claimed, EmergencyPrintedAt: printedAt})
	if claimed {
		h.publish([]uuid.UUID{orderID})
	}
}

// POST /api/orders/:id/cups/:cupId/emergency-label/release - 緊急のシールの印刷に失敗したので空に戻す
func (h *CaosHandler) ReleaseEmergencyLabel(c *gin.Context) {
	orderID, cupID, ok := orderCupParams(c)
	if !ok {
		return
	}
	var req models.EmergencyLabelRelease
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	released, err := h.releaseEmergencyLabel(orderID, cupID, req.EmergencyPrintedAt)
	if err != nil {
		respondNotFoundOr500(c, err)
		return
	}
	if !released {
		c.JSON(http.StatusConflict, gin.H{"error": "印刷した時刻が変わっています"})
		return
	}
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
	h.publish([]uuid.UUID{orderID})
}
