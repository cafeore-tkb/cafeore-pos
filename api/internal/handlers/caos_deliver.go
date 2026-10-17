package handlers

import (
	"cmp"
	"net/http"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// ドリップ完了の報告（POST /api/caos/drippers/:dripper/deliver）。ドリッパーが淹れたカードを提供へ持って行ったときに、提供に置いた端末から送る。
//   - カードが抽出中なら終える（brew_finished_at。「次へ」の start_next が false と同じ）。待機の先頭は始めない（始めるのは CaOS の ▶）
//   - カードのカップ・入れ直しに、提供へ届けた時刻（delivered_at）を付ける
//   - カードのカップ（入れ直しは入れ直したカップ）の注文ごとに、全部のカップがそろったら、注文と全部のカップを準備完了（ready_at）にする。
//     呼び出し画面はそれで呼ぶ。そろったかは deliverCall で決める（抽出が要らないカップと、提供で仕上げる種類のカップは、提供の画面で準備完了にするまでそろわない）
//
// 盤面は「次へ」と同じ順番でロックしてから書き（ドリッパーの advisory lock → 注文の行）、準備完了は提供の画面と同じくカップと注文をそろえて書く
// （syncOrderWithCups・saveOrderStatus）。もう全部届けたカード（二度押し）は何も変えない。

// deliverCall は、届けた注文をどうするか。order はロックした注文（カップは準備完了・提供の時刻を見る）、
// cups はその注文のカップ（ID ごと。種類と入れ直しを読み、届けた時刻は書いたあとの値）。
//   - 準備完了・提供済みの注文：already（変えない）
//   - 準備完了でないカップに、抽出が要らない（ミルクなど）か、提供で仕上げる種類（needs_finishing）のカップがある：finishing（提供が呼び出す）
//   - まだ届けていないカップがある（入れ直しがあれば、入れ直しを全部届けたか）：waiting
//   - そうでなければ called（全部のカップがそろった）
func deliverCall(order *models.Order, cups map[uuid.UUID]*models.OrderCup) models.CaosDeliverCall {
	if order.ReadyAt != nil || order.ServedAt != nil {
		return models.CaosDeliverAlready
	}
	finishing, waiting := false, false
	for _, c := range order.OrderCups {
		if c.ReadyAt != nil || c.ServedAt != nil {
			continue
		}
		cup := cups[c.ID]
		switch {
		case cup == nil:
			waiting = true
		case !cup.Item.ItemType.BrewRequired() || cup.Item.ItemType.NeedsFinishing:
			finishing = true
		case !cupDelivered(cup):
			waiting = true
		}
	}
	switch {
	case finishing:
		return models.CaosDeliverFinishing
	case waiting:
		return models.CaosDeliverWaiting
	}
	return models.CaosDeliverCalled
}

// cupDelivered はカップを提供へ届けたか。入れ直しがあれば、入れ直しを全部届けたか（最初の抽出を届けていても、入れ直す前のものなので見ない）
func cupDelivered(cup *models.OrderCup) bool {
	if len(cup.Emergencies) == 0 {
		return cup.DeliveredAt != nil
	}
	for _, e := range cup.Emergencies {
		if e.DeliveredAt == nil {
			return false
		}
	}
	return true
}

// readyDeliveredOrder は注文を準備完了にする（まだのカップに now を付け、注文をカップにそろえる）。変わった分だけ書く
func readyDeliveredOrder(tx *gorm.DB, order *models.Order, now time.Time) error {
	before := *order
	before.OrderCups = slices.Clone(order.OrderCups)
	for i := range order.OrderCups {
		if order.OrderCups[i].ReadyAt == nil {
			order.OrderCups[i].ReadyAt = &now
		}
	}
	syncOrderWithCups(order)
	return saveOrderStatus(tx, &before, order)
}

// deliver はドリッパー（dripper）のカード（dripID）を届けたことにする。返すのは注文ごとにどうしたか（注文番号の順）と、
// 書いた注文（配る）、準備完了にした注文（在庫の通知を確かめる）。
func (h *CaosHandler) deliver(dripper int, dripID uuid.UUID) (result []models.CaosDeliveredOrder, written, readied []uuid.UUID, err error) {
	now := h.now().Truncate(time.Millisecond)
	start, end := caosToday(now)
	err = h.db.Transaction(func(tx *gorm.DB) error {
		result, written, readied = nil, nil, nil
		if err := lockCaosDrippers(tx, []int{dripper}); err != nil {
			return err
		}
		units, err := readCaosUnits(tx, "c.drip_id = ?", dripID)
		if err != nil {
			return err
		}
		if len(units) == 0 {
			return conflictErrorf("このカードはもうありません（ほかの端末で動かしたか、注文が編集・削除されたかもしれません）")
		}
		first := units[0]
		switch {
		case first.Dripper == nil || *first.Dripper != dripper:
			return conflictErrorf("このカードはもうこのドリッパーにありません（ほかの端末で動かしたかもしれません）")
		case first.BrewStartedAt == nil:
			return conflictErrorf("このカードはまだ抽出を始めていません（マスターが CaOS で始めてから報告してください）")
		case first.BrewFinishedAt == nil && now.Sub(*first.BrewStartedAt) < caosNextCooldown:
			return ruleErrorf("始めてから %d 秒は報告できません", int(caosNextCooldown/time.Second))
		}

		var lockIDs []uuid.UUID
		for _, u := range units {
			lockIDs = append(lockIDs, u.OrderID)
		}
		orders, err := lockCaosOrders(tx, lockIDs, nil, start, end)
		if err != nil {
			return err
		}
		// ロックする前に読んだカップが、そのままか
		locked, err := readCaosUnits(tx, "c.drip_id = ?", dripID)
		if err != nil {
			return err
		}
		if len(locked) != len(units) {
			return errConflict
		}
		for _, u := range units {
			i := slices.IndexFunc(locked, func(c caosUnit) bool { return c.ID == u.ID })
			if i < 0 || !sameCaosState(&locked[i].OrderCup, caosCupState(&u.OrderCup)) || !timeEqual(locked[i].DeliveredAt, u.DeliveredAt) {
				return errConflict
			}
		}

		// 新しく届けたカップの注文だけ、呼び出すかを決める（二度押しや、提供が呼び出しを取り消した注文を呼び直さない）
		fresh := map[uuid.UUID]bool{}
		for _, u := range units {
			if u.DeliveredAt == nil {
				fresh[u.OrderID] = true
			}
		}
		if first.BrewFinishedAt == nil {
			at, err := caosBrewAt(tx, dripper, now, start, end)
			if err != nil {
				return err
			}
			if err := updateCaosUnits(tx, map[string]any{"brew_finished_at": at}, "drip_id = ?", dripID); err != nil {
				return err
			}
		}
		if len(fresh) > 0 {
			if err := updateCaosUnits(tx, map[string]any{"delivered_at": now}, "drip_id = ? AND delivered_at IS NULL", dripID); err != nil {
				return err
			}
		}

		ids := make([]uuid.UUID, 0, len(orders))
		for id := range orders {
			ids = append(ids, id)
		}
		var cups []models.OrderCup
		unscoped := func(db *gorm.DB) *gorm.DB { return db.Unscoped() }
		if err := tx.Preload("Item", unscoped).Preload("Item.ItemType", unscoped).Preload("Emergencies").
			Find(&cups, "order_id IN ?", ids).Error; err != nil {
			return err
		}
		byID := make(map[uuid.UUID]*models.OrderCup, len(cups))
		for i := range cups {
			byID[cups[i].ID] = &cups[i]
		}
		for _, id := range ids {
			order := orders[id]
			call := models.CaosDeliverAlready
			if fresh[id] {
				call = deliverCall(order, byID)
			}
			if call == models.CaosDeliverCalled {
				if err := readyDeliveredOrder(tx, order, now); err != nil {
					return err
				}
				readied = append(readied, id)
			}
			result = append(result, models.CaosDeliveredOrder{Id: openapi_types.UUID(id), OrderId: order.OrderId, Call: call})
		}
		slices.SortFunc(result, func(a, b models.CaosDeliveredOrder) int { return cmp.Compare(a.OrderId, b.OrderId) })
		if len(fresh) > 0 || first.BrewFinishedAt == nil {
			written = ids
		}
		return nil
	})
	return result, written, readied, err
}

// deliverRetrying は deliver を、ロックする前に読んだカップが変わっていた（注文の編集などと重なった）ときだけ読み直して行う。
func (h *CaosHandler) deliverRetrying(dripper int, dripID uuid.UUID) ([]models.CaosDeliveredOrder, []uuid.UUID, []uuid.UUID, error) {
	for range caosAttempts {
		result, written, readied, err := h.deliver(dripper, dripID)
		if err != errConflict {
			return result, written, readied, err
		}
	}
	return nil, nil, nil, conflictErrorf("注文の変更と重なりました。もう一度押してください")
}

// POST /api/caos/drippers/:dripper/deliver - ドリップ完了の報告。応答は注文ごとにどうしたか。書いた注文は「次へ」と同じく配る
func (h *CaosHandler) DeliverCaosDrip(c *gin.Context) {
	dripper, ok := caosDripperParam(c)
	if !ok {
		return
	}
	var req models.CaosDeliverRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	result, written, readied, err := h.deliverRetrying(dripper, uuid.UUID(req.DripId))
	if respondError(c, err) {
		return
	}
	c.JSON(http.StatusOK, models.CaosDeliverResponse{Orders: result})
	h.publish(written)
	// 抽出が要るカップの在庫は、提供可能にした時刻で使う（Inventory.consumption）
	if len(readied) > 0 {
		go h.inventory.CheckAlerts(h.inventory.ResourceIDsForOrders(readied...))
	}
}
