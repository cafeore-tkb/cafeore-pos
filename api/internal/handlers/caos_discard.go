package handlers

import (
	"cafeore-pos/api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"net/http"
	"strings"
	"time"
)

// DiscardCaosCups は対象の抽出だけを終了し、brew.discard として既存の成功履歴に残す。
func (h *CaosHandler) DiscardCaosCups(c *gin.Context) {
	var req models.CaosDiscardRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ids, err := h.discardCups(req)
	h.respond(c, ids, err)
}

func (h *CaosHandler) discardCups(req models.CaosDiscardRequest) ([]uuid.UUID, error) {
	if len(req.CupIds) == 0 || len(req.CupIds) > caosMaxCups || req.DripId == uuid.Nil || req.Before.Dripper == nil || *req.Before.Dripper < 1 || *req.Before.Dripper > 6 || req.Before.DripId == nil || *req.Before.DripId == req.DripId || req.Before.BrewFinishedAt != nil {
		return nil, ruleErrorf("破棄の対象が不正です")
	}
	seen := map[uuid.UUID]bool{}
	for _, id := range req.CupIds {
		if id == uuid.Nil || seen[id] {
			return nil, ruleErrorf("破棄の対象が不正です")
		}
		seen[id] = true
	}
	now := h.now().Truncate(time.Millisecond)
	pressed := caosPressedAt(req.Press, now)
	start, end := caosToday(now)
	var orderIDs []uuid.UUID
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := lockCaosDrippers(tx, []int{*req.Before.Dripper}); err != nil {
			return err
		}
		lockIDs, _, err := readCaosUnitItems(tx, req.CupIds)
		if err != nil {
			return err
		}
		orders, err := lockCaosOrders(tx, lockIDs, nil, start, end)
		if err != nil {
			return err
		}
		for id := range orders {
			orderIDs = append(orderIDs, id)
		}
		units, err := readCaosUnits(tx, "c.id IN ?", req.CupIds)
		if err != nil {
			return err
		}
		if len(units) != len(req.CupIds) {
			return conflictErrorf("カップが見つかりません")
		}
		// 再送は同じ終了カードIDで判定し、破棄履歴を重複させない。
		done := true
		for _, unit := range units {
			if unit.DripID == nil || *unit.DripID != req.DripId || unit.BrewFinishedAt == nil {
				done = false
			}
		}
		if done {
			return nil
		}
		existing, err := readCaosUnits(tx, "c.drip_id = ?", req.DripId)
		if err != nil {
			return err
		}
		if len(existing) > 0 {
			return ruleErrorf("破棄後のカードIDが使われています")
		}
		at, err := caosBrewAt(tx, *req.Before.Dripper, pressed, start, end)
		if err != nil {
			return err
		}
		for _, unit := range units {
			if !sameCaosState(&unit.OrderCup, req.Before) {
				return conflictErrorf("カードの状態が変わりました。もう一度確認してください")
			}
			created := orders[unit.OrderID].CreatedAt
			if unit.ID != unit.CupID {
				var source models.CupEmergency
				if err := tx.First(&source, "id = ?", unit.ID).Error; err != nil {
					return err
				}
				if strings.TrimSpace(source.Reason) == "ラベル再発行" {
					return ruleErrorf("淹れ直し元の未完了の抽出だけ破棄できます")
				}
				created = source.CreatedAt
			}
			since := created
			if unit.BrewStartedAt != nil && unit.BrewStartedAt.After(since) {
				since = *unit.BrewStartedAt
			}
			var count int64
			if err := tx.Model(&models.CupEmergency{}).Where("order_cup_id = ? AND id <> ? AND created_at >= ? AND created_at >= ? AND created_at <= ? AND btrim(reason) <> ?", unit.CupID, unit.ID, created, since, now, "ラベル再発行").Count(&count).Error; err != nil {
				return err
			}
			if count == 0 {
				return ruleErrorf("淹れ直し元の未完了の抽出だけ破棄できます")
			}
			if unit.BrewStartedAt != nil && unit.BrewStartedAt.After(at) {
				at = *unit.BrewStartedAt
			}
		}
		window, err := readCaosLogWindow(tx, req.CupIds, []uuid.UUID{*req.Before.DripId}, start, end)
		if err != nil {
			return err
		}
		// 一部だけの破棄でも残るカップのカードID・開始時刻は変えない。
		if err := updateCaosUnits(tx, map[string]any{"drip_id": req.DripId, "brew_finished_at": at}, "id IN ?", req.CupIds); err != nil {
			return err
		}
		return recordCaosOperation(tx, "brew.discard", at, now, req.Press, window, req.CupIds, nil)
	})
	return orderIDs, err
}
