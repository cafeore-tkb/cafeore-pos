package handlers

import (
	"cmp"
	"errors"
	"fmt"
	"log"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// CaOS（ドリップ管制）の書き込み。盤面は注文のカップ（order_cups）の列で持つ（models.OrderCup の Dripper・DripperPosition・
// DripID・BrewStartedAt・BrewFinishedAt）。画面は注文の一覧からカードを組み立てる。
//
//   - PUT /api/caos/cups：カップの組を before から after にする（割当・移動・順番・未割当に戻す・統合）。before が今と違えば 409。
//     順番の数（dripper_position）と抽出の時刻は画面から受け取らない。画面は「どのカードの前に入れるか」（after の before）だけを送り、
//     番号はサーバーが決める（placeCaosCups）。空いているドリッパーで始めるときは after の start_brew で受け、サーバーの今を入れる
//   - POST /api/caos/drippers/:dripper/next：「次へ」。抽出中のカードを終え、そのカップを準備完了にし、待機の先頭を始める
//
// どちらも注文の行をロックしてからカップを読む（注文の編集・カップの準備完了と同じ順番）。カップを置くドリッパーの advisory lock は
// 注文の行より先に取り、列の番号を決めて書き終えるまで・1 つのドリッパーで抽出中が 1 枚かを確かめるまで、同じドリッパーへの書き込みを待たせる。
// 書いたカップの注文（番号をずらしたカップの注文も）は今の注文の配信（1 件ずつ）で、このインスタンスにつないでいる画面へ届く（publishOrder）。

const (
	// ドリッパーの数。番号は 1〜caosDrippers
	caosDrippers = 6
	// 1 枚のカード（1 回のドリップ）で淹れる最大の杯数
	caosMaxCups = 2
	// 「次へ」が注文と重なって読み直す回数
	caosAttempts = 3
)

var (
	// before が今の値と違う（ほかの端末が先に書いた・注文の編集で消えた）
	errCaosConflict = errors.New("caos: cups changed")
	jst             = time.FixedZone("JST", 9*60*60)
)

// 決まりに合わない書き込み。理由を画面にそのまま出す（422）
type caosRuleError struct{ message string }

func (e *caosRuleError) Error() string { return e.message }

func caosRule(format string, args ...any) error {
	return &caosRuleError{message: fmt.Sprintf(format, args...)}
}

// 楽観ロックで断る理由（409）
type caosConflictError struct{ message string }

func (e *caosConflictError) Error() string { return e.message }
func (e *caosConflictError) Unwrap() error { return errCaosConflict }

func caosConflict(message string) error { return &caosConflictError{message: message} }

type CaosHandler struct {
	db  *gorm.DB
	hub *Hub
	// 今の時刻（テストで差し替える）。今日の範囲と、抽出の開始・終了の時刻に使う（iPad の時計は使わない）
	now func() time.Time
}

func NewCaosHandler(db *gorm.DB, hub *Hub) *CaosHandler {
	return &CaosHandler{db: db, hub: hub, now: time.Now}
}

// caosToday は今日（日本時間）の始まりと終わり。CaOS は作成日時がこの間の注文だけを見る。
func caosToday(now time.Time) (time.Time, time.Time) {
	t := now.In(jst)
	start := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, jst)
	return start, start.AddDate(0, 0, 1)
}

// ---------------------------------------------------------------- カップの値

// caosCupState はカップの今の CaOS の値（PUT の before と同じ形）。
func caosCupState(c *models.OrderCup) models.CaosCupState {
	return models.CaosCupState{
		Dripper: c.Dripper, DripperPosition: c.DripperPosition, DripId: c.DripID,
		BrewStartedAt: c.BrewStartedAt, BrewFinishedAt: c.BrewFinishedAt,
	}
}

// sameCaosState はカップの今の値が s と同じか。時刻はミリ秒までで比べる
// （画面の Date はミリ秒までしか持たないので、送り返された before と比べられるように）。
func sameCaosState(c *models.OrderCup, s models.CaosCupState) bool {
	return ptrEqual(c.Dripper, s.Dripper) && ptrEqual(c.DripperPosition, s.DripperPosition) && ptrEqual(c.DripID, s.DripId) &&
		timeEqual(msTime(c.BrewStartedAt), msTime(s.BrewStartedAt)) && timeEqual(msTime(c.BrewFinishedAt), msTime(s.BrewFinishedAt))
}

func msTime(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	v := t.Truncate(time.Millisecond)
	return &v
}

func ptrEqual[T comparable](a, b *T) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && *a == *b)
}

// validateCaosAfter は書く値の形を確かめる（400）。
func validateCaosAfter(a models.CaosCupAfter) error {
	if a.Dripper == nil {
		if a.Before != nil || a.StartBrew {
			return errors.New("ドリッパーの無いカップは、前に入れるカードを決められず、抽出も始められません")
		}
		return nil
	}
	if *a.Dripper < 1 || *a.Dripper > caosDrippers {
		return fmt.Errorf("ドリッパーは 1〜%d です", caosDrippers)
	}
	if a.DripId == nil {
		return errors.New("ドリッパーに置くカップには drip_id が要ります")
	}
	if a.Before != nil && *a.Before == *a.DripId {
		return errors.New("自分のカードの前には入れられません")
	}
	if a.Before != nil && a.StartBrew {
		return errors.New("抽出を始めるのは空いているドリッパーだけなので、前に入れるカードは決められません")
	}
	return nil
}

// caosUpdates は after を書く列。position はサーバーが決めた番号（未割当なら nil）。
// startedAt は抽出を始めるときのサーバーの今（始めないなら nil）。終了の時刻は「次へ」だけが付ける。
func caosUpdates(a models.CaosCupAfter, position *int, startedAt *time.Time) map[string]any {
	return map[string]any{
		"dripper":          a.Dripper,
		"dripper_position": position,
		"drip_id":          a.DripId,
		"brew_started_at":  startedAt,
		"brew_finished_at": nil,
	}
}

// lockCaosDrippers は抽出中を作るドリッパーの advisory lock を番号の順に取る（注文の行より先に取る）。
func lockCaosDrippers(tx *gorm.DB, drippers []int) error {
	for _, d := range uniqueInts(drippers) {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "caos:dripper:"+strconv.Itoa(d)).Error; err != nil {
			return err
		}
	}
	return nil
}

func uniqueInts(v []int) []int {
	out := slices.Clone(v)
	slices.Sort(out)
	return slices.Compact(out)
}

// lockCaosOrders は注文の行を ID の順にロックし、カップを読む。orderIDs（書くカップの注文）は、消えていれば 409、今日の注文でなければ 422。
// extra（番号をずらすかもしれないカップの注文）もいっしょに ID の順でロックする（消えていたら飛ばす）。返すのは orderIDs の注文だけ。
// ロックは 1 回の並びで取る（2 回に分けると、ほかの書き込みと順番が逆になってデッドロックしうる）。
func lockCaosOrders(tx *gorm.DB, orderIDs, extra []uuid.UUID, start, end time.Time) (map[uuid.UUID]*models.Order, error) {
	must := make(map[uuid.UUID]bool, len(orderIDs))
	for _, id := range orderIDs {
		must[id] = true
	}
	ids := slices.Concat(orderIDs, extra)
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	ids = slices.Compact(ids)
	orders := make(map[uuid.UUID]*models.Order, len(orderIDs))
	for _, id := range ids {
		order, err := lockOrderWith(tx, id)
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound) && !must[id]:
			continue
		case errors.Is(err, gorm.ErrRecordNotFound):
			return nil, caosConflict("注文が消えました（ほかの端末で削除されたかもしれません）")
		case err != nil:
			return nil, err
		case !must[id]:
			continue
		}
		if order.CreatedAt.Before(start) || !order.CreatedAt.Before(end) {
			return nil, caosRule("今日の注文のカップだけ書けます")
		}
		orders[id] = &order
	}
	return orders, nil
}

func findCaosCup(orders map[uuid.UUID]*models.Order, cupID uuid.UUID) *models.OrderCup {
	for _, order := range orders {
		if cup := findOrderCup(order, cupID); cup != nil {
			return cup
		}
	}
	return nil
}

// ---------------------------------------------------------------- ドリッパーの列

// ドリッパーの列のカップ（注文番号つき）
type caosLaneCup struct {
	models.OrderCup
	OrderNo int
}

// ドリッパーの中のカード（同じ drip_id のカップ）
type caosLaneCard struct {
	dripID  uuid.UUID
	cups    []caosLaneCup
	orderNo int
}

// ドリッパーの中の順番（同じカードのカップは同じ値）
func (c *caosLaneCard) position() int {
	if p := c.cups[0].DripperPosition; p != nil {
		return *p
	}
	return 0
}

// readCaosLane はドリッパーの、今日の注文で終えていないカップを読む。
func readCaosLane(tx *gorm.DB, dripper int, start, end time.Time) ([]caosLaneCup, error) {
	var rows []caosLaneCup
	err := tx.Raw(`
		SELECT c.*, o.order_id AS order_no
		FROM order_cups c JOIN orders o ON o.id = c.order_id
		WHERE o.created_at >= ? AND o.created_at < ? AND c.dripper = ? AND c.brew_finished_at IS NULL`,
		start, end, dripper).Scan(&rows).Error
	return rows, err
}

// splitCaosLane はドリッパーのカップを、抽出中のカードと待機のカード（先頭から順に）に分ける。
// 画面の caosLane（modules/common/src/lib/caos-board.ts。buildCaosCards の状態と compareQueued の並び）と同じ決まり：
//   - 終了の時刻があるか、カップが全部準備完了（マスターで準備完了にした）のカードは終わり（どちらにも入れない）
//   - 開始の時刻があれば抽出中、無ければ待機
//   - 待機の並びは dripper_position・いちばん小さい注文番号・drip_id の順
//
// 同じ入力で同じ結果になることを、両方のテストが modules/common/src/lib/caos-lane-cases.json で確かめる。
func splitCaosLane(rows []caosLaneCup) (brewing, queued []*caosLaneCard) {
	var cards []*caosLaneCard
	byID := map[uuid.UUID]*caosLaneCard{}
	for _, r := range rows {
		if r.DripID == nil {
			continue
		}
		card, ok := byID[*r.DripID]
		if !ok {
			card = &caosLaneCard{dripID: *r.DripID, orderNo: r.OrderNo}
			byID[*r.DripID] = card
			cards = append(cards, card)
		}
		card.cups = append(card.cups, r)
		card.orderNo = min(card.orderNo, r.OrderNo)
	}
	for _, card := range cards {
		first := card.cups[0]
		allReady := !slices.ContainsFunc(card.cups, func(cup caosLaneCup) bool { return cup.ReadyAt == nil })
		switch {
		case first.BrewFinishedAt != nil || allReady:
		case first.BrewStartedAt != nil:
			brewing = append(brewing, card)
		default:
			queued = append(queued, card)
		}
	}
	slices.SortFunc(queued, func(a, b *caosLaneCard) int {
		return cmp.Or(
			cmp.Compare(a.position(), b.position()),
			cmp.Compare(a.orderNo, b.orderNo),
			strings.Compare(a.dripID.String(), b.dripID.String()),
		)
	})
	return brewing, queued
}

// ---------------------------------------------------------------- 順番

// 今日の注文の、あるドリッパーに置いた、まだ終わっていないカップから、書いているカップを除いたもの。
// ? は順に、今日の始まり・終わり・ドリッパー・書いているカップの ID
const caosLaneWhere = `o.id = c.order_id AND o.created_at >= ? AND o.created_at < ?
	AND c.dripper = ? AND c.brew_finished_at IS NULL AND c.id NOT IN ?`

// placeCaosCups は、書くカップ（w.CupIds）を w.After.Dripper に置く番号を決める。番号をずらしたカップの注文も返す。
//   - drip_id がほかのカップ（この書き込みに入っていないもの）と同じなら、そのカードに入る（統合）。番号はそのカードと同じ。ずらさない
//   - before が無ければ最後：そのドリッパーの終わっていないカップの最大＋1（無ければ 1）。ずらさない
//   - before があれば、そのカード（そのドリッパーの待機）の番号 p に入れる。番号が p 以上の終わっていないカップを全部 +1 する（UPDATE 1 文）
//
// 抜けたカードの番号は空いたままにし、全部の振り直しはしない。呼ぶ前に、そのドリッパーの advisory lock と、
// ずらすカップの注文の行のロックを取っておく（writeCups）。
func placeCaosCups(tx *gorm.DB, w models.CaosCupsWrite, start, end time.Time) (int, []uuid.UUID, error) {
	dripper := *w.After.Dripper
	var joined []models.OrderCup
	if err := tx.Where("drip_id = ? AND id NOT IN ?", *w.After.DripId, w.CupIds).Limit(1).Find(&joined).Error; err != nil {
		return 0, nil, err
	}
	if len(joined) > 0 {
		if w.After.Before != nil {
			return 0, nil, caosRule("ほかのカードに入れるときは、前に入れるカードは決められません")
		}
		if joined[0].DripperPosition == nil {
			return 0, nil, caosRule("同じカードのカップは全部いっしょに動かしてください")
		}
		return *joined[0].DripperPosition, nil, nil
	}

	if w.After.Before == nil {
		var last int
		err := tx.Raw("SELECT COALESCE(MAX(c.dripper_position), 0) + 1 FROM order_cups c, orders o WHERE "+caosLaneWhere,
			start, end, dripper, w.CupIds).Scan(&last).Error
		return last, nil, err
	}

	var found []int
	if err := tx.Raw("SELECT c.dripper_position FROM order_cups c, orders o WHERE "+caosLaneWhere+
		" AND c.drip_id = ? AND c.brew_started_at IS NULL AND c.dripper_position IS NOT NULL LIMIT 1",
		start, end, dripper, w.CupIds, *w.After.Before).Scan(&found).Error; err != nil {
		return 0, nil, err
	}
	if len(found) == 0 {
		return 0, nil, caosConflict("前に入れるカードが、そのドリッパーの待機にありません（ほかの端末で動いたかもしれません）")
	}
	p := found[0]
	var shifted []uuid.UUID
	if err := tx.Raw("UPDATE order_cups c SET dripper_position = c.dripper_position + 1 FROM orders o WHERE "+caosLaneWhere+
		" AND c.dripper_position >= ? RETURNING c.order_id",
		start, end, dripper, w.CupIds, p).Scan(&shifted).Error; err != nil {
		return 0, nil, err
	}
	return p, shifted, nil
}

// ---------------------------------------------------------------- PUT /api/caos/cups

func validateCaosWrites(req models.CaosCupsWriteRequest) error {
	if len(req.Writes) == 0 {
		return errors.New("writes が空です")
	}
	seen := map[uuid.UUID]bool{}
	for _, w := range req.Writes {
		if len(w.CupIds) == 0 {
			return errors.New("cup_ids が空です")
		}
		if err := validateCaosAfter(w.After); err != nil {
			return err
		}
		for _, id := range w.CupIds {
			if seen[id] {
				return errors.New("同じカップを 2 回書いています")
			}
			seen[id] = true
		}
	}
	return nil
}

// writeCups は writes を 1 つのトランザクションで書く。書いた注文（番号をずらしたカップの注文も）の ID を返す。
// 抽出を始める書き込みの brew_started_at は、サーバーの今（ミリ秒まで）。
func (h *CaosHandler) writeCups(writes []models.CaosCupsWrite) ([]uuid.UUID, error) {
	now := h.now().Truncate(time.Millisecond)
	start, end := caosToday(now)
	var cupIDs []uuid.UUID
	var placing, inserting, brewing []int
	for _, w := range writes {
		cupIDs = append(cupIDs, w.CupIds...)
		if w.After.Dripper != nil {
			placing = append(placing, *w.After.Dripper)
		}
		if w.After.Before != nil {
			inserting = append(inserting, *w.After.Dripper)
		}
		if w.After.StartBrew {
			brewing = append(brewing, *w.After.Dripper)
		}
	}
	var orderIDs []uuid.UUID
	err := h.db.Transaction(func(tx *gorm.DB) error {
		orderIDs = nil
		if err := lockCaosDrippers(tx, placing); err != nil {
			return err
		}
		// どの注文のカップか・抽出の要る商品か（ロックする注文を決めるだけ。CaOS の値はロックしてから読む）。
		// 後から削除した商品・種類のカップも、注文の応答と同じく読む
		unscoped := func(db *gorm.DB) *gorm.DB { return db.Unscoped() }
		var found []models.OrderCup
		if err := tx.Preload("Item", unscoped).Preload("Item.ItemType", unscoped).
			Find(&found, "id IN ?", cupIDs).Error; err != nil {
			return err
		}
		if len(found) != len(cupIDs) {
			return caosConflict("カップが消えました（注文が編集・削除されたかもしれません）")
		}
		items := make(map[uuid.UUID]models.Item, len(found))
		var lockIDs []uuid.UUID
		for _, c := range found {
			items[c.ID] = c.Item
			lockIDs = append(lockIDs, c.OrderID)
		}
		// 途中に入れるドリッパーの列のカップは番号を +1 するので、その注文の行もロックする
		// （注文の編集はカップを同じ値で入れ直すので、ロックせずにずらすと、ずらした番号が消えうる）。
		// 列に入るのは advisory lock を取った CaOS の書き込みだけなので、ここで読んだ列よりずらすカップは増えない
		var laneOrderIDs []uuid.UUID
		for _, d := range uniqueInts(inserting) {
			rows, err := readCaosLane(tx, d, start, end)
			if err != nil {
				return err
			}
			for _, r := range rows {
				laneOrderIDs = append(laneOrderIDs, r.OrderID)
			}
		}
		orders, err := lockCaosOrders(tx, lockIDs, laneOrderIDs, start, end)
		if err != nil {
			return err
		}
		changed := map[uuid.UUID]bool{}
		for id := range orders {
			changed[id] = true
		}

		touched := map[uuid.UUID]bool{}
		for _, w := range writes {
			for _, id := range w.CupIds {
				cup := findCaosCup(orders, id)
				if cup == nil {
					return caosConflict("カップが消えました（注文が編集されたかもしれません）")
				}
				if !sameCaosState(cup, w.Before) {
					return caosConflict("ほかの端末で先に変わりました。もう一度操作してください")
				}
				// 抽出中・終わりのカードは動かさない（時刻はサーバーが付けるので、書き直すと時刻が消える。終えるのは「次へ」）
				if w.Before.BrewStartedAt != nil || w.Before.BrewFinishedAt != nil {
					return caosRule("抽出中・終わりのカードは動かせません")
				}
				if (w.After.Dripper != nil || w.After.DripId != nil) && !items[id].ItemType.BrewRequired() {
					return caosRule("抽出の要らないカップ（%s）はドリッパーに置けません", items[id].Name)
				}
			}
			var position *int
			if w.After.Dripper != nil {
				p, shifted, err := placeCaosCups(tx, w, start, end)
				if err != nil {
					return err
				}
				position = &p
				for _, id := range shifted {
					changed[id] = true
				}
			}
			var startedAt *time.Time
			if w.After.StartBrew {
				startedAt = &now
			}
			if err := tx.Model(&models.OrderCup{}).Where("id IN ?", w.CupIds).Updates(caosUpdates(w.After, position, startedAt)).Error; err != nil {
				return err
			}
			if w.After.DripId != nil {
				touched[*w.After.DripId] = true
			}
		}

		// 書いたカードの全部のカップ（書かなかったカップも含む）が同じ値で、最大 2 杯か
		for id := range touched {
			var cups []models.OrderCup
			if err := tx.Where("drip_id = ?", id).Find(&cups).Error; err != nil {
				return err
			}
			if len(cups) > caosMaxCups {
				return caosRule("1 枚のカードは %d 杯までです", caosMaxCups)
			}
			for i := range cups {
				if !sameCaosState(&cups[i], caosCupState(&cups[0])) {
					return caosRule("同じカードのカップは全部いっしょに動かしてください")
				}
			}
		}
		// 1 つのドリッパーで抽出中は 1 枚（「次へ」と同じ決まりで数える）
		for _, d := range uniqueInts(brewing) {
			rows, err := readCaosLane(tx, d, start, end)
			if err != nil {
				return err
			}
			if cards, _ := splitCaosLane(rows); len(cards) > 1 {
				return caosRule("%d 番のドリッパーはもう抽出中です", d)
			}
		}
		for id := range changed {
			orderIDs = append(orderIDs, id)
		}
		return nil
	})
	return orderIDs, err
}

// PUT /api/caos/cups - CaOS が決めたこと（ドリッパー・順番・カード・抽出の開始）をカップに書く
func (h *CaosHandler) WriteCaosCups(c *gin.Context) {
	var req models.CaosCupsWriteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateCaosWrites(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	orderIDs, err := h.writeCups(req.Writes)
	if respondCaosError(c, err) {
		return
	}
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
	h.publish(orderIDs)
}

// ---------------------------------------------------------------- 「次へ」

// advance は「次へ」を 1 回行う。seen は画面が抽出中と見ているカード。書いた注文を返す。
func (h *CaosHandler) advance(dripper int, seen *uuid.UUID) ([]uuid.UUID, error) {
	now := h.now().Truncate(time.Millisecond)
	start, end := caosToday(now)
	var orderIDs []uuid.UUID
	err := h.db.Transaction(func(tx *gorm.DB) error {
		orderIDs = nil
		if err := lockCaosDrippers(tx, []int{dripper}); err != nil {
			return err
		}
		rows, err := readCaosLane(tx, dripper, start, end)
		if err != nil {
			return err
		}
		brewing, queued := splitCaosLane(rows)
		var cur, head *caosLaneCard
		if len(brewing) > 0 {
			cur = brewing[0]
		}
		switch {
		case seen != nil && (cur == nil || cur.dripID != *seen):
			return caosConflict("このカードはもう終わっています（ほかの端末で「次へ」を押したかもしれません）")
		case seen == nil && cur != nil:
			return caosConflict("抽出中のカードがあります（画面が古いかもしれません）")
		}
		if len(queued) > 0 {
			head = queued[0]
		}
		if cur == nil && head == nil {
			return caosConflict("このドリッパーには抽出中・待機のカードがありません")
		}

		var ids []uuid.UUID
		for _, card := range []*caosLaneCard{cur, head} {
			if card == nil {
				continue
			}
			for _, cup := range card.cups {
				ids = append(ids, cup.OrderID)
			}
		}
		orders, err := lockCaosOrders(tx, ids, nil, start, end)
		if err != nil {
			return err
		}
		// ロックする前に読んだカップが、そのままか
		for _, card := range []*caosLaneCard{cur, head} {
			if card == nil {
				continue
			}
			for _, r := range card.cups {
				cup := findCaosCup(orders, r.ID)
				if cup == nil || !sameCaosState(cup, caosCupState(&r.OrderCup)) || !timeEqual(cup.ReadyAt, r.ReadyAt) {
					return errCaosConflict
				}
			}
		}

		if cur != nil {
			// カップを準備完了にし、注文の状態をカップから決め直す（POS のカップの準備完了と同じ）
			for _, order := range orders {
				before := *order
				before.OrderCups = slices.Clone(order.OrderCups)
				changed := false
				for i := range order.OrderCups {
					cup := &order.OrderCups[i]
					if !ptrEqual(cup.DripID, &cur.dripID) {
						continue
					}
					changed = true
					if cup.ReadyAt == nil {
						cup.ReadyAt = &now
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
			if err := tx.Model(&models.OrderCup{}).Where("drip_id = ?", cur.dripID).
				Update("brew_finished_at", now).Error; err != nil {
				return err
			}
		}
		if head != nil {
			if err := tx.Model(&models.OrderCup{}).Where("drip_id = ?", head.dripID).
				Update("brew_started_at", now).Error; err != nil {
				return err
			}
		}
		for id := range orders {
			orderIDs = append(orderIDs, id)
		}
		return nil
	})
	return orderIDs, err
}

// POST /api/caos/drippers/:dripper/next - 「次へ」。結果は書いた注文の配信で届くので、応答は 204（PUT と同じ）
func (h *CaosHandler) AdvanceCaosDripper(c *gin.Context) {
	dripper, err := strconv.Atoi(c.Param("dripper"))
	if err != nil || dripper < 1 || dripper > caosDrippers {
		c.JSON(http.StatusBadRequest, gin.H{"error": fmt.Sprintf("ドリッパーは 1〜%d です", caosDrippers)})
		return
	}
	var req models.CaosNextRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var orderIDs []uuid.UUID
	for range caosAttempts {
		orderIDs, err = h.advance(dripper, req.DripId)
		// ロックする前に読んだカップが変わっていた（注文の編集などと重なった）ときだけ読み直す
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
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
	h.publish(orderIDs)
}

// ---------------------------------------------------------------- 共通

// respondCaosError はエラーを返したら true。
func respondCaosError(c *gin.Context, err error) bool {
	var rule *caosRuleError
	switch {
	case err == nil:
		return false
	case errors.As(err, &rule):
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": rule.message})
	case errors.Is(err, errCaosConflict):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	default:
		log.Printf("caos: %v", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	}
	return true
}

// publish は書いた注文を読み直して、このインスタンスにつないでいる画面へ配る。
func (h *CaosHandler) publish(orderIDs []uuid.UUID) {
	for _, id := range orderIDs {
		if _, err := publishOrder(h.db, h.hub, id); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("caos: failed to publish order %s: %v", id, err)
		}
	}
}
