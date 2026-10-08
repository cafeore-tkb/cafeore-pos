package handlers

import (
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
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// CaOS（ドリップ管制）の書き込み。盤面は注文のカップ（order_cups）の列で持つ（models.OrderCup の Dripper・DripperPosition・
// DripID・BrewStartedAt・BrewFinishedAt。緊急のカップは入れ直しの列 Emergency*。caos_emergency.go の caosCol）。
// 画面は注文の一覧からカードを組み立てる。
//
//   - PUT /api/caos/cups：カップの組を before から after にする（割当・移動・順番・未割当に戻す・統合）。before が今と違えば 409。
//     抽出の時刻は画面から受け取らない。空いているドリッパーで始めるときは after の start_brew で受け、サーバーの今を入れる。
//     限定のカップは、今日の担当者が上級生のドリッパーにしか置けない（担当者は caos_lanes.go）
//   - POST /api/caos/drippers/:dripper/next：「次へ」。抽出中のカードを終え、そのカップを準備完了にし、待機の先頭を始める
//
// どちらも注文の行をロックしてからカップを読む（注文の編集・カップの準備完了と同じ順番）。抽出中のカードを作る書き込みは、
// そのドリッパーの advisory lock を注文の行より先に取り、1 つのドリッパーで抽出中が 1 枚かを順番に確かめる。
// 書いたカップの注文は今の注文の配信（1 件ずつ）で全部の画面へ、ほかのインスタンスへは orders_changed で届く（publishOrder）。
//
// 練習（実データテスト）はブラウザの中だけで動かし、writeCups・advance と caos_lanes.go の限定の確かめと同じ決まり・同じ理由の文を
// modules/common/src/lib/caosPractice.ts が持つ（わざと 2 か所にある）。決まりや文を変えるときは両方そろえること。

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

// caosState は CaOS がカップに書く値（カップの今の値）。
type caosState struct {
	Dripper         *int
	DripperPosition *float64
	DripID          *uuid.UUID
	BrewStartedAt   *time.Time
	BrewFinishedAt  *time.Time
}

// cupCaosState はカップの CaOS のカードの値。緊急のカップは入れ直しの列（最初の抽出の列は見ない。caosCol と同じ）。
func cupCaosState(c *models.OrderCup) caosState {
	if c.EmergencyAt != nil {
		return caosState{c.EmergencyDripper, c.EmergencyDripperPosition, c.EmergencyDripID, c.EmergencyBrewStartedAt, c.EmergencyBrewFinishedAt}
	}
	return caosState{c.Dripper, c.DripperPosition, c.DripID, c.BrewStartedAt, c.BrewFinishedAt}
}

func apiCaosState(s models.CaosCupState) caosState {
	return caosState{s.Dripper, s.DripperPosition, apiDripID(s.DripId), msTime(s.BrewStartedAt), msTime(s.BrewFinishedAt)}
}

// apiCaosAfter は書く値（時刻は無い。始めるときの時刻は書くときにサーバーの今を入れる）。
func apiCaosAfter(s models.CaosCupAfter) caosState {
	return caosState{Dripper: s.Dripper, DripperPosition: s.DripperPosition, DripID: apiDripID(s.DripId)}
}

func apiDripID(id *openapi_types.UUID) *uuid.UUID {
	if id == nil {
		return nil
	}
	v := uuid.UUID(*id)
	return &v
}

// 時刻はミリ秒までにそろえる（画面の Date はミリ秒までしか持たないので、送り返された before と比べられるように）
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

func msEqual(a, b *time.Time) bool {
	return (a == nil && b == nil) || (a != nil && b != nil && msTime(a).Equal(*msTime(b)))
}

func (s caosState) equal(o caosState) bool {
	return ptrEqual(s.Dripper, o.Dripper) && ptrEqual(s.DripperPosition, o.DripperPosition) &&
		ptrEqual(s.DripID, o.DripID) && msEqual(s.BrewStartedAt, o.BrewStartedAt) && msEqual(s.BrewFinishedAt, o.BrewFinishedAt)
}

// 抽出を始めた（抽出中か終わり）値か
func (s caosState) started() bool { return s.BrewStartedAt != nil || s.BrewFinishedAt != nil }

// validate は書く値の形を確かめる（400）。start は抽出を始めるか（after の start_brew）。
func (s caosState) validate(start bool) error {
	if s.Dripper == nil {
		if s.DripperPosition != nil || start {
			return errors.New("ドリッパーの無いカップに順番は書けず、抽出も始められません")
		}
		return nil
	}
	if *s.Dripper < 1 || *s.Dripper > caosDrippers {
		return fmt.Errorf("ドリッパーは 1〜%d です", caosDrippers)
	}
	if s.DripID == nil || s.DripperPosition == nil {
		return errors.New("ドリッパーに置くカップには drip_id と dripper_position が要ります")
	}
	return nil
}

// updates は書く列。emergency なら入れ直しの列（emergency_ を前に付けた列）。
func (s caosState) updates(emergency bool) map[string]any {
	prefix := ""
	if emergency {
		prefix = "emergency_"
	}
	return map[string]any{
		prefix + "dripper":          s.Dripper,
		prefix + "dripper_position": s.DripperPosition,
		prefix + "drip_id":          s.DripID,
		prefix + "brew_started_at":  s.BrewStartedAt,
		prefix + "brew_finished_at": s.BrewFinishedAt,
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

// lockCaosOrders は注文の行を ID の順にロックし、明細とカップを読む。今日の注文でなければ断る。
func lockCaosOrders(tx *gorm.DB, orderIDs []uuid.UUID, start, end time.Time) (map[uuid.UUID]*models.Order, error) {
	ids := slices.Clone(orderIDs)
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) })
	ids = slices.Compact(ids)
	orders := make(map[uuid.UUID]*models.Order, len(ids))
	for _, id := range ids {
		order, err := lockOrder(tx, id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, caosConflict("注文が消えました（ほかの端末で削除されたかもしれません）")
		}
		if err != nil {
			return nil, err
		}
		if order.CreatedAt.Before(start) || !order.CreatedAt.Before(end) {
			return nil, caosRule("今日の注文のカップだけ書けます")
		}
		orders[id] = &order
	}
	return orders, nil
}

// 抽出中のカードの数（そのドリッパーの今日の注文で、始めていてまだ終えておらず、準備完了でないカップが残っているもの。
// 入れ直しのカードは準備完了でも数える（カップが準備完了のまま入れ直すことがある））
func countBrewing(tx *gorm.DB, dripper int, start, end time.Time) (int64, error) {
	var n int64
	err := tx.Raw(`
		SELECT COUNT(*) FROM (
			SELECT `+caosCardSQL("c")+`
			FROM order_cups c JOIN orders o ON o.id = c.order_id
			WHERE o.created_at >= ? AND o.created_at < ? AND `+caosCol("c", "dripper")+` = ?
				AND `+caosCol("c", "brew_started_at")+` IS NOT NULL AND `+caosCol("c", "brew_finished_at")+` IS NULL
			GROUP BY `+caosCardSQL("c")+`
			HAVING bool_or(c.ready_at IS NULL OR c.emergency_at IS NOT NULL)
		) AS brewing`, start, end, dripper).Scan(&n).Error
	return n, err
}

// ---------------------------------------------------------------- PUT /api/caos/cups

type caosWrite struct {
	cups          []uuid.UUID
	before, after caosState
	// 抽出を始める（after の brew_started_at に、書くときのサーバーの今を入れる）
	start bool
}

func toCaosWrites(req models.CaosCupsWriteRequest) ([]caosWrite, error) {
	if len(req.Writes) == 0 {
		return nil, errors.New("writes が空です")
	}
	seen := map[uuid.UUID]bool{}
	writes := make([]caosWrite, len(req.Writes))
	for i, w := range req.Writes {
		if len(w.CupIds) == 0 {
			return nil, errors.New("cup_ids が空です")
		}
		out := caosWrite{before: apiCaosState(w.Before), after: apiCaosAfter(w.After), start: w.After.StartBrew}
		if err := out.after.validate(out.start); err != nil {
			return nil, err
		}
		for _, id := range w.CupIds {
			if seen[uuid.UUID(id)] {
				return nil, errors.New("同じカップを 2 回書いています")
			}
			seen[uuid.UUID(id)] = true
			out.cups = append(out.cups, uuid.UUID(id))
		}
		writes[i] = out
	}
	return writes, nil
}

// writeCups は writes を 1 つのトランザクションで書く。書いた注文の ID を返す。
// 抽出を始める書き込みの brew_started_at は、サーバーの今（ミリ秒まで）。
func (h *CaosHandler) writeCups(writes []caosWrite) ([]uuid.UUID, error) {
	now := h.now().Truncate(time.Millisecond)
	start, end := caosToday(now)
	var cupIDs []uuid.UUID
	var brewing []int
	for i, w := range writes {
		cupIDs = append(cupIDs, w.cups...)
		if w.start {
			writes[i].after.BrewStartedAt = &now
			brewing = append(brewing, *w.after.Dripper)
		}
	}
	var orderIDs []uuid.UUID
	err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := lockCaosDrippers(tx, brewing); err != nil {
			return err
		}
		// どの注文のカップか（ロックする注文を決めるだけ。値はロックしてから読む）
		var rows []struct {
			ID      uuid.UUID
			OrderID uuid.UUID
			Brew    bool
			// 限定（種類の senior_only）。抽出が要るときだけ（models.ItemType.SeniorOnlyBrew と同じ）
			Senior bool
		}
		if err := tx.Raw(`
			SELECT c.id, c.order_id, COALESCE(t.makes_cup, true) AND COALESCE(t.needs_brew, true) AS brew,
				COALESCE(t.makes_cup, true) AND COALESCE(t.needs_brew, true) AND COALESCE(t.senior_only, false) AS senior
			FROM order_cups c
			LEFT JOIN items i ON i.id = c.item_id
			LEFT JOIN item_types t ON t.id = i.item_type_id
			WHERE c.id IN ?`, cupIDs).Scan(&rows).Error; err != nil {
			return err
		}
		if len(rows) != len(cupIDs) {
			return caosConflict("カップが消えました（注文が編集・削除されたかもしれません）")
		}
		needsBrew := make(map[uuid.UUID]bool, len(rows))
		seniorOnly := make(map[uuid.UUID]bool, len(rows))
		orderIDs = orderIDs[:0]
		for _, r := range rows {
			needsBrew[r.ID] = r.Brew
			seniorOnly[r.ID] = r.Senior
			orderIDs = append(orderIDs, r.OrderID)
		}
		// 限定のカップを置くなら、今日の担当者が上級生のドリッパー（caos_lanes.go）
		seniors, err := caosSeniorDrippers(tx, writes, seniorOnly, now)
		if err != nil {
			return err
		}
		orders, err := lockCaosOrders(tx, orderIDs, start, end)
		if err != nil {
			return err
		}
		orderIDs = orderIDs[:0]
		for id := range orders {
			orderIDs = append(orderIDs, id)
		}

		touched := map[uuid.UUID]bool{}
		for _, w := range writes {
			for _, id := range w.cups {
				order, cup := findCaosCup(orders, id)
				if cup == nil {
					return caosConflict("カップが消えました（注文が編集されたかもしれません）")
				}
				if !cupCaosState(cup).equal(w.before) {
					return caosConflict("ほかの端末で先に変わりました。もう一度操作してください")
				}
				// 抽出中・終わりのカードは動かさない（時刻はサーバーが付けるので、書き直すと時刻が消える。終えるのは「次へ」）
				if w.before.started() {
					return caosRule("抽出中・終わりのカードは動かせません")
				}
				if (w.after.Dripper != nil || w.after.DripID != nil) && !needsBrew[id] {
					return caosRule("抽出の要らないカップ（%s）はドリッパーに置けません", cupItemName(tx, cup))
				}
				if w.after.Dripper != nil {
					// 指名は明細のドリッパーの番号（dripper）。自由記述（assignee）だけの古い明細は指名なし
					if n := menuDripper(order, cup.OrderMenuID); n != nil && *n != *w.after.Dripper {
						return caosRule("指名のあるカップは %d 番のドリッパーにしか置けません", *n)
					}
				}
				if err := checkSeniorOnly(tx, w, cup, seniorOnly[id], seniors); err != nil {
					return err
				}
			}
			if err := updateCaosCups(tx, w.cups, w.after); err != nil {
				return err
			}
			if w.after.DripID != nil {
				touched[*w.after.DripID] = true
			}
		}

		// 書いたカードの全部のカップ（書かなかったカップも含む）が同じ値で、最大 2 杯か
		for id := range touched {
			var cups []models.OrderCup
			if err := whereCaosCard(tx, id).Find(&cups).Error; err != nil {
				return err
			}
			if len(cups) > caosMaxCups {
				return caosRule("1 枚のカードは %d 杯までです", caosMaxCups)
			}
			for i := range cups {
				if !cupCaosState(&cups[i]).equal(cupCaosState(&cups[0])) {
					return caosRule("同じカードのカップは全部いっしょに動かしてください")
				}
				if (cups[i].EmergencyAt == nil) != (cups[0].EmergencyAt == nil) {
					return caosRule("入れ直しのカードはほかのカードと統合できません")
				}
			}
			if err := checkCaosCardNomination(tx, id); err != nil {
				return err
			}
		}
		for _, d := range uniqueInts(brewing) {
			n, err := countBrewing(tx, d, start, end)
			if err != nil {
				return err
			}
			if n > 1 {
				return caosRule("%d 番のドリッパーはもう抽出中です", d)
			}
		}
		return nil
	})
	return orderIDs, err
}

func findCaosCup(orders map[uuid.UUID]*models.Order, cupID uuid.UUID) (*models.Order, *models.OrderCup) {
	for _, order := range orders {
		if cup := findOrderCup(order, cupID); cup != nil {
			return order, cup
		}
	}
	return nil, nil
}

// checkCaosCardNomination は 1 枚のカードのカップの指名（明細のドリッパーの番号。無指名も 1 つの値）がそろっているかを確かめる。
// 指名の違うカップを統合すると、どのドリッパーにも置けないカードになるので断る。
// カードは caosCardSQL で見る（入れ直しのカードは emergency_drip_id。最初に淹れたカードの drip_id は見ない）
func checkCaosCardNomination(tx *gorm.DB, dripID uuid.UUID) error {
	var nominations int64
	if err := tx.Raw(`
		SELECT COUNT(DISTINCT COALESCE(m.dripper, 0))
		FROM order_cups c
		JOIN order_menus m ON m.id = c.order_menu_id
		WHERE `+caosCardSQL("c")+` = ?`, dripID).Scan(&nominations).Error; err != nil {
		return err
	}
	if nominations > 1 {
		return caosRule("指名の違うカップは同じカードにできません")
	}
	return nil
}

// menuDripper はカップを含む明細の指名のドリッパーの番号（無指名は nil）
func menuDripper(order *models.Order, orderMenuID uuid.UUID) *int {
	for _, line := range order.OrderMenus {
		if line.ID == orderMenuID {
			return line.Dripper
		}
	}
	return nil
}

func cupItemName(tx *gorm.DB, cup *models.OrderCup) string {
	var item models.Item
	if err := tx.Unscoped().Select("name").First(&item, "id = ?", cup.ItemID).Error; err != nil {
		return "不明な商品"
	}
	return item.Name
}

// PUT /api/caos/cups - CaOS が決めたこと（ドリッパー・順番・カード・抽出の時刻）をカップに書く
func (h *CaosHandler) WriteCaosCups(c *gin.Context) {
	var req models.CaosCupsWriteRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	writes, err := toCaosWrites(req)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	orderIDs, err := h.writeCups(writes)
	if respondCaosError(c, err) {
		return
	}
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
	h.publish(orderIDs)
}

// ---------------------------------------------------------------- 「次へ」

// 「次へ」で読むドリッパーのカップ
type caosLaneCup struct {
	ID              uuid.UUID
	OrderID         uuid.UUID
	OrderNo         int
	DripID          *uuid.UUID
	DripperPosition *float64
	BrewStartedAt   *time.Time
	BrewFinishedAt  *time.Time
	ReadyAt         *time.Time
	EmergencyAt     *time.Time
}

// ドリッパーの中のカード（同じ drip_id のカップ）
type caosLaneCard struct {
	dripID  uuid.UUID
	cups    []caosLaneCup
	orderNo int
}

func (c *caosLaneCard) allReady() bool {
	return !slices.ContainsFunc(c.cups, func(cup caosLaneCup) bool { return cup.ReadyAt == nil })
}

// 終わりとみなすカード：準備完了になったカード（マスターで準備完了にした）。
// 入れ直しのカードは、カップが準備完了のまま入れ直すことがあるので、準備完了でも終わりにしない（「次へ」で終える）
func (c *caosLaneCard) done() bool {
	return c.cups[0].EmergencyAt == nil && c.allReady()
}

// ドリッパーの中の順番（同じカードのカップは同じ値）
func (c *caosLaneCard) position() float64 {
	if p := c.cups[0].DripperPosition; p != nil {
		return *p
	}
	return 0
}

// advance は「次へ」を 1 回行う。終えたカードと始めたカード、書いた注文を返す。
func (h *CaosHandler) advance(dripper int, seen *uuid.UUID) (finished, started *uuid.UUID, orderIDs []uuid.UUID, err error) {
	now := h.now().Truncate(time.Millisecond)
	start, end := caosToday(now)
	err = h.db.Transaction(func(tx *gorm.DB) error {
		finished, started, orderIDs = nil, nil, nil
		if err := lockCaosDrippers(tx, []int{dripper}); err != nil {
			return err
		}
		// 準備完了になったカード（マスターで準備完了にした）は終わりとみなす（入れ直しのカードは除く。caosLaneCard.done）
		brewing, queued, err := readCaosLane(tx, dripper, start, end)
		if err != nil {
			return err
		}

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
		orders, err := lockCaosOrders(tx, ids, start, end)
		if err != nil {
			return err
		}
		// ロックする前に読んだカップが、そのままか
		for _, card := range []*caosLaneCard{cur, head} {
			if card == nil {
				continue
			}
			for _, r := range card.cups {
				_, cup := findCaosCup(orders, r.ID)
				if cup == nil {
					return errCaosConflict
				}
				if s := cupCaosState(cup); !ptrEqual(s.Dripper, &dripper) || !ptrEqual(s.DripID, r.DripID) ||
					!msEqual(s.BrewStartedAt, r.BrewStartedAt) || s.BrewFinishedAt != nil || !timeEqual(cup.ReadyAt, r.ReadyAt) {
					return errCaosConflict
				}
			}
		}

		if cur != nil {
			finished = &cur.dripID
			// カップを準備完了にし、注文の状態をカップから決め直す（POS のカップの準備完了と同じ）
			for _, order := range orders {
				before := *order
				before.OrderCups = slices.Clone(order.OrderCups)
				changed := false
				for i := range order.OrderCups {
					cup := &order.OrderCups[i]
					if !ptrEqual(caosCardID(cup), &cur.dripID) {
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
			if err := finishCaosCard(tx, cur.dripID, now); err != nil {
				return err
			}
		}
		if head != nil {
			started = &head.dripID
			if err := updateCaosCard(tx, head.dripID, "brew_started_at", now); err != nil {
				return err
			}
		}
		for id := range orders {
			orderIDs = append(orderIDs, id)
		}
		return nil
	})
	return finished, started, orderIDs, err
}

// POST /api/caos/drippers/:dripper/next - 「次へ」
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
	var seen *uuid.UUID
	if req.DripId != nil {
		id := uuid.UUID(*req.DripId)
		seen = &id
	}
	var finished, started *uuid.UUID
	var orderIDs []uuid.UUID
	for range caosAttempts {
		finished, started, orderIDs, err = h.advance(dripper, seen)
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
	c.JSON(http.StatusOK, models.CaosNextResult{FinishedDripId: apiUUID(finished), StartedDripId: apiUUID(started)})
	h.publish(orderIDs)
}

func apiUUID(id *uuid.UUID) *openapi_types.UUID {
	if id == nil {
		return nil
	}
	v := openapi_types.UUID(*id)
	return &v
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

// publish は書いた注文を、このインスタンスの画面へ配り、ほかのインスタンスへ知らせる。
func (h *CaosHandler) publish(orderIDs []uuid.UUID) {
	for _, id := range orderIDs {
		if _, err := publishOrder(h.db, h.hub, id); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("caos: failed to publish order %s: %v", id, err)
		}
	}
}
