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
// 提供済み（served_at）は書き戻さず、変わっていれば断る。緊急（emergency_at）も書き戻さず、変わっていれば断る（緊急を戻すのは今は無い）。
//
// 書き戻した結果も PUT /api/caos/cups と同じ決まりで確かめる（戻した結果が決まりに反するなら 422 で断る）：
//   - 指名のあるカップは指名のドリッパーにだけ（明細の dripper）。1 枚のカードの指名はそろう
//   - 限定のカップをほかのドリッパーへ戻すなら、今日の今の担当者が上級生のドリッパーだけ（操作のあとで担当者が替わっていれば断る）
//
// 緊急のカップのカードは、PUT /api/caos/cups と同じく emergency_drip_id で持つ（cupCaosState・updateCaosCups・whereCaosCard）。
// 担当者の交代（caos_lanes）と緊急は戻さない。戻すなら、カップを書かない操作として画面の useCaosUndo の remember に戻す処理を渡して足す。

// caosUndoState は「1つ戻す」で比べる・書き戻すカップの値（CaOS の列と、準備完了・提供済み・緊急）。
// DripID は CaOS のカード（緊急のカップは入れ直しのカード。caosCardID）。
type caosUndoState struct {
	caosState
	ReadyAt     *time.Time
	ServedAt    *time.Time
	EmergencyAt *time.Time
}

func apiCaosUndoState(s models.CaosUndoCupState) caosUndoState {
	return caosUndoState{
		caosState:   caosState{s.Dripper, s.DripperPosition, apiDripID(s.DripId), msTime(s.BrewStartedAt), msTime(s.BrewFinishedAt)},
		ReadyAt:     msTime(s.ReadyAt),
		ServedAt:    msTime(s.ServedAt),
		EmergencyAt: msTime(s.EmergencyAt),
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
		// 緊急は書き戻さない（緊急を戻すのは今は無い）
		if !msEqual(r.EmergencyAt, cup.current.EmergencyAt) {
			return nil, errors.New("緊急は戻せません（restore の emergency_at は current と同じにしてください）")
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
	now := h.now()
	start, end := caosToday(now)
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
		// どの注文のカップか・限定か（PUT /api/caos/cups の writeCups と同じ読み方）
		var rows []struct {
			ID      uuid.UUID
			OrderID uuid.UUID
			Senior  bool
		}
		if err := tx.Raw(`
			SELECT c.id, c.order_id,
				COALESCE(t.makes_cup, true) AND COALESCE(t.needs_brew, true) AND COALESCE(t.senior_only, false) AS senior
			FROM order_cups c
			LEFT JOIN items i ON i.id = c.item_id
			LEFT JOIN item_types t ON t.id = i.item_type_id
			WHERE c.id IN ?`, cupIDs).Scan(&rows).Error; err != nil {
			return err
		}
		if len(rows) != len(cupIDs) {
			return caosConflict("カップが消えたので戻せません（注文が編集・削除されたかもしれません）")
		}
		var ids []uuid.UUID
		seniorOnly := make(map[uuid.UUID]bool, len(rows))
		for _, r := range rows {
			ids = append(ids, r.OrderID)
			seniorOnly[r.ID] = r.Senior
		}
		// 戻すのを「今の値（current）から前の値（restore）への書き込み」とみて、PUT /api/caos/cups と同じく限定を確かめる
		writes := make([]caosWrite, len(cups))
		for i, c := range cups {
			writes[i] = caosWrite{cups: []uuid.UUID{c.id}, before: c.current.caosState, after: c.restore.caosState}
		}
		seniors, err := caosSeniorDrippers(tx, writes, seniorOnly, now)
		if err != nil {
			return err
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
			case !msEqual(cup.EmergencyAt, c.current.EmergencyAt):
				return caosConflict("緊急（入れ直し）になったカップがあるので戻せません")
			case !msEqual(cup.ReadyAt, c.current.ReadyAt):
				return caosConflict("準備完了がほかの画面で変わったので戻せません")
			case !cupCaosState(cup).equal(c.current.caosState):
				return caosConflict("ほかの画面で先に変わったので戻せません")
			}
		}

		// 戻した結果が決まりに合うか（指名・限定。PUT /api/caos/cups と同じ）
		for i, c := range cups {
			if c.restore.Dripper == nil {
				continue
			}
			order, cup := findCaosCup(orders, c.id)
			if n := menuDripper(order, cup.OrderMenuID); n != nil && *n != *c.restore.Dripper {
				return caosRule("指名のあるカップは %d 番のドリッパーにしか置けないので戻せません", *n)
			}
			if err := checkSeniorOnly(tx, writes[i], cup, seniorOnly[c.id], seniors); err != nil {
				return undoRule(err)
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
			// カードの印は、緊急のカップには emergency_drip_id に、それ以外は drip_id に書く
			if err := updateCaosCups(tx, []uuid.UUID{c.id}, c.restore.caosState); err != nil {
				return err
			}
			if c.restore.DripID != nil {
				touched[*c.restore.DripID] = true
			}
		}

		// 書き戻したあとも盤面の決まりに合うか（合わないのは、その間にほかの画面が変えたから）
		for id := range touched {
			var same []models.OrderCup
			if err := whereCaosCard(tx, id).Find(&same).Error; err != nil {
				return err
			}
			if len(same) > caosMaxCups {
				return caosConflict(fmt.Sprintf("1 枚のカードが %d 杯を超えるので戻せません（ほかの画面で変わったかもしれません）", caosMaxCups))
			}
			for i := range same {
				if !cupCaosState(&same[i]).equal(cupCaosState(&same[0])) {
					return caosConflict("同じカードのカップがほかの画面で変わったので戻せません")
				}
				if (same[i].EmergencyAt == nil) != (same[0].EmergencyAt == nil) {
					return caosConflict("入れ直しのカードとほかのカードが混ざるので戻せません")
				}
			}
			if err := checkCaosCardNomination(tx, id); err != nil {
				return undoRule(err)
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

// undoRule は決まりに合わない理由（422）に「戻せません」を付ける（それ以外のエラーはそのまま）
func undoRule(err error) error {
	var rule *caosRuleError
	if errors.As(err, &rule) {
		return caosRule("戻せません：%s", rule.message)
	}
	return err
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
