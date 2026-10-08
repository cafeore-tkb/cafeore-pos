package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// POST /api/caos/undo：CaOS の「1つ戻す」。各画面（各 iPad の /master-sheet）が、自分が最後にした操作を条件付きで書き戻す。
//
// 画面は操作の前の値（restore）と、その操作で自分が書いた値（current。サーバーが付けた時刻も含む）をカップごとに覚えておいて送る。
// カップの今の値が current とぴったり同じ（時刻もミリ秒まで）ときだけ restore を書く。ほかの画面（ほかの CaOS の iPad・マスター・提供）が
// あとで同じカップを変えていたら、何も書かずに 409 で断る（ほかの画面の操作を消さない）。
//
// PUT /api/caos/cups は抽出中・終わりのカップを書けない（時刻はサーバーが付けるので、画面から書くと時刻が消える）。
// ここでは、今の値が「自分が書いた値」と同じことを確かめてから「自分が書く前の値」に戻すだけなので、抽出中・終わりのカップと
// 準備完了（ready_at）も書き戻す（「次へ」で終えたカードを抽出中に戻して準備完了を外す・空いているドリッパーで始めたカードを戻す）。
// 提供済み（served_at）は書き戻さず、変わっていれば断る。

// caosUndoState は「1つ戻す」で比べる・書き戻すカップの値（CaOS の列と、準備完了・提供済み）。
type caosUndoState struct {
	caosState
	ReadyAt  *time.Time
	ServedAt *time.Time
}

func apiCaosUndoState(s models.CaosUndoCupState) caosUndoState {
	return caosUndoState{
		caosState: caosState{s.Dripper, s.DripperPosition, apiDripID(s.DripId), msTime(s.BrewStartedAt), msTime(s.BrewFinishedAt)},
		ReadyAt:   msTime(s.ReadyAt),
		ServedAt:  msTime(s.ServedAt),
	}
}

// 抽出中（始めていて終えていない）か
func (s caosUndoState) brewing() bool { return s.BrewStartedAt != nil && s.BrewFinishedAt == nil }

type caosUndoCup struct {
	id               uuid.UUID
	current, restore caosUndoState
}

func toCaosUndoCups(req models.CaosUndoRequest) ([]caosUndoCup, error) {
	if len(req.Cups) == 0 {
		return nil, errors.New("cups が空です")
	}
	seen := map[uuid.UUID]bool{}
	out := make([]caosUndoCup, len(req.Cups))
	for i, c := range req.Cups {
		id := uuid.UUID(c.CupId)
		if seen[id] {
			return nil, errors.New("同じカップを 2 回書いています")
		}
		seen[id] = true
		cup := caosUndoCup{id: id, current: apiCaosUndoState(c.Current), restore: apiCaosUndoState(c.Restore)}
		r := cup.restore
		if r.Dripper == nil && (r.DripperPosition != nil || r.BrewStartedAt != nil || r.BrewFinishedAt != nil) {
			return nil, errors.New("ドリッパーの無いカップに順番・抽出の時刻は書けません")
		}
		if r.Dripper != nil {
			if *r.Dripper < 1 || *r.Dripper > caosDrippers {
				return nil, fmt.Errorf("ドリッパーは 1〜%d です", caosDrippers)
			}
			if r.DripID == nil || r.DripperPosition == nil {
				return nil, errors.New("ドリッパーに置くカップには drip_id と dripper_position が要ります")
			}
		}
		// 提供済みは書き戻さない（提供の操作を消さない）
		if !msEqual(r.ServedAt, cup.current.ServedAt) {
			return nil, errors.New("提供済みは戻せません（restore の served_at は current と同じにしてください）")
		}
		if r.ServedAt != nil && r.ReadyAt == nil {
			return nil, errors.New("提供済みのカップの準備完了は外せません")
		}
		out[i] = cup
	}
	return out, nil
}

// undoCups は cups を 1 つのトランザクションで書き戻す。書いた注文の ID を返す。
func (h *CaosHandler) undoCups(cups []caosUndoCup) ([]uuid.UUID, error) {
	start, end := caosToday(h.now())
	cupIDs := make([]uuid.UUID, len(cups))
	var brewing []int
	for i, c := range cups {
		cupIDs[i] = c.id
		// 抽出中に戻すカード（「次へ」を戻す）は、ほかの書き込みと同じくドリッパーの lock を取ってから数える
		if c.restore.brewing() {
			brewing = append(brewing, *c.restore.Dripper)
		}
	}
	var orderIDs []uuid.UUID
	err := h.db.Transaction(func(tx *gorm.DB) error {
		orderIDs = nil
		if err := lockCaosDrippers(tx, brewing); err != nil {
			return err
		}
		var rows []struct {
			ID      uuid.UUID
			OrderID uuid.UUID
		}
		if err := tx.Raw(`SELECT id, order_id FROM order_cups WHERE id IN ?`, cupIDs).Scan(&rows).Error; err != nil {
			return err
		}
		if len(rows) != len(cupIDs) {
			return caosConflict("カップが消えたので戻せません（注文が編集・削除されたかもしれません）")
		}
		var ids []uuid.UUID
		for _, r := range rows {
			ids = append(ids, r.OrderID)
		}
		orders, err := lockCaosOrders(tx, ids, start, end)
		if err != nil {
			return err
		}

		// 今の値が、その操作で書いた値のままか（提供済み・準備完了・CaOS の列の順に、変わった理由を返す）
		for _, c := range cups {
			_, cup := findCaosCup(orders, c.id)
			if cup == nil {
				return caosConflict("カップが消えたので戻せません（注文が編集されたかもしれません）")
			}
			switch {
			case !msEqual(cup.ServedAt, c.current.ServedAt):
				return caosConflict("提供済みになったカップがあるので戻せません（提供の操作を消さないため）")
			case !msEqual(cup.ReadyAt, c.current.ReadyAt):
				return caosConflict("準備完了がほかの画面で変わったので戻せません")
			case !cupCaosState(cup).equal(c.current.caosState):
				return caosConflict("ほかの画面で先に変わったので戻せません")
			}
		}

		// 準備完了を戻し、注文の状態をカップから決め直す（POS のカップの準備完了と同じ）
		for id, order := range orders {
			orderIDs = append(orderIDs, id)
			before := *order
			before.OrderCups = slices.Clone(order.OrderCups)
			changed := false
			for _, c := range cups {
				if cup := findOrderCup(order, c.id); cup != nil && !msEqual(cup.ReadyAt, c.restore.ReadyAt) {
					cup.ReadyAt = c.restore.ReadyAt
					changed = true
				}
			}
			if !changed {
				continue
			}
			syncOrderWithCups(order)
			if err := saveOrderStatus(tx, &before, order); err != nil {
				return err
			}
		}
		touched := map[uuid.UUID]bool{}
		for _, c := range cups {
			if err := tx.Model(&models.OrderCup{}).Where("id = ?", c.id).Updates(c.restore.updates()).Error; err != nil {
				return err
			}
			if c.restore.DripID != nil {
				touched[*c.restore.DripID] = true
			}
		}

		// 書き戻したあとも盤面の決まりに合うか（合わないのは、その間にほかの画面が変えたから）
		for id := range touched {
			var same []models.OrderCup
			if err := tx.Where("drip_id = ?", id).Find(&same).Error; err != nil {
				return err
			}
			if len(same) > caosMaxCups {
				return caosConflict(fmt.Sprintf("1 枚のカードが %d 杯を超えるので戻せません（ほかの画面で変わったかもしれません）", caosMaxCups))
			}
			for i := range same {
				if !cupCaosState(&same[i]).equal(cupCaosState(&same[0])) {
					return caosConflict("同じカードのカップがほかの画面で変わったので戻せません")
				}
			}
		}
		for _, d := range uniqueInts(brewing) {
			n, err := countBrewing(tx, d, start, end)
			if err != nil {
				return err
			}
			if n > 1 {
				return caosConflict(fmt.Sprintf("%d 番のドリッパーでほかのカードが抽出中なので戻せません", d))
			}
		}
		return nil
	})
	return orderIDs, err
}

// POST /api/caos/undo - 「1つ戻す」（今の値がその操作で書いた値のときだけ、操作の前の値に書き戻す）
func (h *CaosHandler) UndoCaosCups(c *gin.Context) {
	var req models.CaosUndoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	cups, err := toCaosUndoCups(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	orderIDs, err := h.undoCups(cups)
	if respondCaosError(c, err) {
		return
	}
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
	h.publish(orderIDs)
}
