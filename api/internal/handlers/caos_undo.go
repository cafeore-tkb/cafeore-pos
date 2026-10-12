package handlers

import (
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// POST /api/caos/undo：CaOS の「1つ戻す」。画面が、自分が最後にした操作（割当・移動・順番の入れ替え・未割当に戻す・統合・次へ）を
// 操作の前の値（restore）に書き戻す。カップの今の値が、画面の見ている値（current）とぴったり同じ（時刻はミリ秒まで）ときだけ書き、
// ほかの端末があとで変えていたら何も書かずに 409 で断る（ほかの端末の操作を消さない）。
//
// PUT /api/caos/cups と違い、抽出中・終わりのカップの時刻と準備完了（ready_at）も書き戻す（「次へ」を戻す・始めたカードを戻す・
// 動かして始めた時刻を消した抽出中のカードを戻す）。戻すのは前の値なので、終えた時刻と準備完了は current と同じか null だけ、
// 始めた時刻は今日の今までの時刻（動かして消した・付け直した前の時刻）。提供済みのカップは戻さない。
// 書き戻した結果も PUT と同じ決まり（指名・上級生のみ・1 枚 2 杯まで・同じカードは同じ値・指名のそろい）と、
// 1 つのドリッパーで抽出中は 1 枚を確かめる。

// validateCaosUndo は書き戻す値の形を確かめる（400）。now はサーバーの今。
func validateCaosUndo(req models.CaosUndoRequest, now time.Time) error {
	today, _ := caosToday(now)
	if len(req.Cups) == 0 {
		return errors.New("cups が空です")
	}
	seen := map[uuid.UUID]bool{}
	for _, c := range req.Cups {
		if seen[c.CupId] {
			return errors.New("同じカップを 2 回書いています")
		}
		seen[c.CupId] = true
		r, cur := c.Restore.State, c.Current.State
		if r.Dripper == nil {
			if r.DripperPosition != nil || r.BrewStartedAt != nil || r.BrewFinishedAt != nil {
				return errors.New("ドリッパーの無いカップに順番・抽出の時刻は書けません")
			}
		} else {
			if err := checkCaosDripper(*r.Dripper); err != nil {
				return err
			}
			if r.DripId == nil || r.DripperPosition == nil {
				return errors.New("ドリッパーに置くカップには drip_id と dripper_position が要ります")
			}
		}
		if t := r.BrewStartedAt; t != nil && (t.Before(today) || t.After(now)) {
			return errors.New("戻す始めた時刻は、今日の今までの時刻だけです")
		}
		for _, t := range [][2]*time.Time{{r.BrewFinishedAt, cur.BrewFinishedAt}, {c.Restore.ReadyAt, c.Current.ReadyAt}} {
			if t[0] != nil && !timeEqual(msTime(t[0]), msTime(t[1])) {
				return errors.New("戻す終えた時刻・準備完了は、今の時刻のままか、消すだけです")
			}
		}
	}
	return nil
}

// undoCups は cups を 1 つのトランザクションで書き戻す。書いた注文の ID を返す。
func (h *CaosHandler) undoCups(cups []models.CaosUndoCup) ([]uuid.UUID, error) {
	now := h.now()
	start, end := caosToday(now)
	cupIDs := make([]uuid.UUID, len(cups))
	var drippers []int
	var dripIDs []uuid.UUID
	// 上級生のみを確かめるため、戻すのを「今の値から前の値への書き込み」とみる（PUT と同じ確かめ方）
	writes := make([]models.CaosCupsWrite, len(cups))
	for i, c := range cups {
		cupIDs[i] = c.CupId
		writes[i] = models.CaosCupsWrite{CupIds: []uuid.UUID{c.CupId}, Before: c.Current.State, After: models.CaosCupAfter{Dripper: c.Restore.State.Dripper, DripId: c.Restore.State.DripId}}
		if d := c.Restore.State.Dripper; d != nil {
			drippers = append(drippers, *d)
		}
		if id := c.Restore.State.DripId; id != nil {
			dripIDs = append(dripIDs, *id)
		}
	}
	var orderIDs []uuid.UUID
	err := h.db.Transaction(func(tx *gorm.DB) error {
		orderIDs = nil
		// 戻すドリッパーの順番を決める・抽出中を数えるあいだ、同じドリッパーへの書き込みを待たせる（PUT・「次へ」と同じ lock）
		if err := lockCaosDrippers(tx, drippers); err != nil {
			return err
		}
		found, lockIDs, items, err := readCaosUnitItems(tx, cupIDs)
		if err != nil {
			return err
		}
		orders, err := lockCaosOrders(tx, lockIDs, nil, start, end)
		if err != nil {
			return err
		}
		seniorOnly := make(map[uuid.UUID]bool, len(found))
		for _, c := range found {
			seniorOnly[c.ID] = items[c.ID].ItemType.SeniorOnlyBrew()
		}
		seniors, err := caosSeniorDrippers(tx, writes, seniorOnly, now)
		if err != nil {
			return err
		}
		nominated, err := caosNominations(tx, lockIDs)
		if err != nil {
			return err
		}
		// 今の値（注文の行をロックしてから読む。入れ直しは準備完了を持たない）
		locked, err := readCaosUnits(tx, "c.id IN ?", cupIDs)
		if err != nil {
			return err
		}
		lockedByID := make(map[uuid.UUID]caosUnit, len(locked))
		var currentCards []uuid.UUID
		for _, c := range locked {
			lockedByID[c.ID] = c
			if c.DripID != nil {
				currentCards = append(currentCards, *c.DripID)
			}
		}
		// 今のカードにほかのカップが入っていたら（あとでほかの画面が統合した）、戻すとそのカードを分けてしまうので断る。
		// 入ってくる書き込みは、このカードのカップの注文（ロックした）をロックするので、ここで読んだより増えない
		if len(currentCards) > 0 {
			others, err := readCaosUnits(tx, "c.drip_id IN ? AND c.id NOT IN ?", currentCards, cupIDs)
			if err != nil {
				return err
			}
			if len(others) > 0 {
				return conflictErrorf("ほかの画面でカードにカップが足されたので戻せません")
			}
		}

		for _, c := range cups {
			unit, ok := lockedByID[c.CupId]
			r := c.Restore.State
			if !ok {
				return conflictErrorf("カップが消えたので戻せません（注文が編集されたかもしれません）")
			}
			// 提供済みは、入れ直しでないカップだけ見る（入れ直しは提供済みのカップにも足すので）
			if cup := findOrderCup(orders[unit.OrderID], unit.ID); cup != nil && cup.ServedAt != nil {
				return conflictErrorf("提供済みになったカップがあるので戻せません")
			}
			switch {
			case !timeEqual(msTime(unit.ReadyAt), msTime(c.Current.ReadyAt)):
				return conflictErrorf("準備完了がほかの画面で変わったので戻せません")
			case !sameCaosState(&unit.OrderCup, c.Current.State):
				return conflictErrorf("ほかの画面で先に変わったので戻せません")
			}
			if (r.Dripper != nil || r.DripId != nil) && !items[c.CupId].ItemType.BrewRequired() {
				return ruleErrorf("抽出の要らないカップ（%s）はドリッパーに置けません", items[c.CupId].Name)
			}
			if n := nominated[unit.OrderMenuID]; r.Dripper != nil && n != nil && *n != *r.Dripper {
				return ruleErrorf("指名のあるカップは %d 番のドリッパーにしか置けないので戻せません", *n)
			}
		}

		// 準備完了を戻し、注文の状態をカップから決め直す（POS のカップの準備完了と同じ）
		for id, order := range orders {
			orderIDs = append(orderIDs, id)
			before := *order
			before.OrderCups = slices.Clone(order.OrderCups)
			changed := false
			for _, c := range cups {
				if cup := findOrderCup(order, c.CupId); cup != nil && !timeEqual(msTime(cup.ReadyAt), msTime(c.Restore.ReadyAt)) {
					cup.ReadyAt = c.Restore.ReadyAt
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
		for _, c := range cups {
			r := c.Restore.State
			if err := updateCaosUnits(tx, map[string]any{
				"dripper":          r.Dripper,
				"dripper_position": r.DripperPosition,
				"drip_id":          r.DripId,
				"brew_started_at":  r.BrewStartedAt,
				"brew_finished_at": r.BrewFinishedAt,
			}, "id = ?", c.CupId); err != nil {
				return err
			}
		}

		// 書き戻したあとも盤面の決まりに合うか（合わないのは、そのあいだにほかの画面が変えたから）
		if err := checkCaosCards(tx, dripIDs); err != nil {
			return err
		}
		if err := checkSeniorOnly(tx, writes, items, seniors); err != nil {
			return err
		}
		d, err := caosBrewingTwice(tx, drippers, start, end)
		if err != nil {
			return err
		}
		if d != 0 {
			return conflictErrorf("%d 番のドリッパーでほかのカードが抽出中なので戻せません", d)
		}
		return nil
	})
	return orderIDs, err
}

// POST /api/caos/undo - 「1つ戻す」（今の値が画面の見ている値のときだけ、操作の前の値に書き戻す）
func (h *CaosHandler) UndoCaosCups(c *gin.Context) {
	var req models.CaosUndoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateCaosUndo(req, h.now()); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	orderIDs, err := h.undoCups(req.Cups)
	h.respond(c, orderIDs, err)
}
