package handlers

import (
	"errors"
	"net/http"
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
// PUT /api/caos/cups と違い、抽出中・終わりのカップの時刻も書き戻す（「次へ」を戻す・始めたカードを戻す・
// 動かして始めた時刻を消した抽出中のカードを戻す）。戻すのは前の値なので、終えた時刻は current と同じか null だけ、
// 始めた時刻は今日の今までの時刻（動かして消した・付け直した前の時刻）。
// 準備完了・提供（ready_at・served_at）は CaOS の操作では変わらず、盤面の決まりにも使わないので、比べも書き戻しもしない
// （提供の画面で提供可能・提供にしたカップの操作も戻せる）。
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
		// 始めた時刻は、抽出中のカードを動かして消した・付け直した前の時刻を戻すので、今の時刻と違ってよい（今日の今までの時刻だけ）
		if t := r.BrewStartedAt; t != nil && (t.Before(today) || t.After(now)) {
			return errors.New("戻す始めた時刻は、今日の今までの時刻だけです")
		}
		if t := r.BrewFinishedAt; t != nil && !timeEqual(msTime(t), msTime(cur.BrewFinishedAt)) {
			return errors.New("戻す終えた時刻は、今の時刻のままか、消すだけです")
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
		// 今の値（注文の行をロックしてから読む）
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
			if !sameCaosState(&unit.OrderCup, c.Current.State) {
				return conflictErrorf("ほかの画面で先に変わったので戻せません")
			}
			if (r.Dripper != nil || r.DripId != nil) && !items[c.CupId].ItemType.BrewRequired() {
				return ruleErrorf("抽出の要らないカップ（%s）はドリッパーに置けません", items[c.CupId].Name)
			}
			if n := nominated[unit.OrderMenuID]; r.Dripper != nil && n != nil && *n != *r.Dripper {
				return ruleErrorf("指名のあるカップは %d 番のドリッパーにしか置けないので戻せません", *n)
			}
		}

		for id := range orders {
			orderIDs = append(orderIDs, id)
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
