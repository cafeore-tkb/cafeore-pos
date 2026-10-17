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
// 緊急（入れ直し。cup_emergencies）の行も同じ列を持ち、カップと同じ決まりでカードに入る（caosUnits。足すのは cup_emergency.go）。
// 以下の「カップ」は入れ直しの行も含む。
//
//   - PUT /api/caos/cups：カップの組を before から after にする（割当・移動・順番・未割当に戻す・統合）。before が今と違えば 409。
//     順番の数（dripper_position）と抽出の時刻は画面から受け取らない。画面は「どのカードの前に入れるか」（after の insert_before）だけを送り、
//     番号はサーバーが決める（placeCaosCups）。列の先頭（抽出中）に入れて始めるときは after の start_brew で受け、押した時刻（caosBrewAt）を入れる。
//     抽出中のカードも動かせる（始めた時刻を消して待機・未割当にする）。書いたあと、1 つのドリッパーで抽出中は 1 枚まで（caosBrewingTwice）。
//     上級生のみのカップ（種類の senior_only）も、担当者が上級生でないドリッパーに置ける（断らない。画面が置いたときに知らせる）
//   - POST /api/caos/drippers/:dripper/next：「次へ」。抽出中のカードを終え（brew_finished_at）、待機の先頭を始める（brew_started_at。start_next が false なら始めない）。
//     カップの準備完了（ready_at）は付けない（付けるのは提供の画面と、ドリップ完了の報告）。抽出を始めてから caosNextCooldown は断る
//     （二度押し・続けて押すのを防ぐ。始めた時刻と「次へ」を押した時刻の差で見る）
//   - POST /api/caos/drippers/:dripper/deliver：ドリップ完了の報告（caos_deliver.go）。抽出中のカードを終え（待機の先頭は始めない）、
//     提供へ届けた時刻を付け、注文のカップがそろえば準備完了にする
//
// 盤面（抽出の開始・終わり・待機）を書くのは CaOS の操作とドリップ完了の報告だけ。提供の画面の準備完了・提供（order_status.go）は盤面を書かず、
// 盤面の決まりも準備完了・提供を見ない（カップが全部準備完了・提供済みになっても、抽出中・待機のカードのまま。終えるのは「次へ」と報告だけ）。
//
// どちらも注文の行をロックしてからカップを読む（注文の編集・カップの準備完了と同じ順番）。カップを置くドリッパーの advisory lock は
// 注文の行より先に取り、列の番号を決めて書き終えるまで・抽出を始めるドリッパーが空いているかを確かめるまで、同じドリッパーへの書き込みを待たせる。
// 書いたカップの注文（番号をずらしたカップの注文も）は今の注文の配信（1 件ずつ）で、このインスタンスにつないでいる画面へ届き、
// ほかのインスタンスにも DB の通知で知らせる（publishOrder）。
//
// 抽出の開始・終了の時刻は、画面が操作を押した時刻（press。端末に残して後ろで送った操作も押したときの時刻）から決める（caosPressedAt・caosBrewAt）。
// 押した時刻を送らない古い画面からの書き込みは、サーバーの今。

const (
	// ドリッパーの数。番号は 1〜caosDrippers（1st〜6th）。注文の明細の指名の番号（order_menus.dripper）も同じ範囲
	caosDrippers = 6
	// 1 枚のカード（1 回のドリップ）で淹れる最大の杯数
	caosMaxCups = 2
	// 「次へ」が注文と重なって読み直す回数
	caosAttempts = 3
	// 抽出を始めてから「次へ」を押せるようになるまで（画面の CAOS_NEXT_COOLDOWN_SEC と同じ）
	caosNextCooldown = 10 * time.Second
	// 送った時刻（端末の時計）がサーバーの今よりこれより後なら、端末の時計が進んでいるとみる（caosPressedAt）
	caosClockAhead = 5 * time.Second
	// 送った時刻がサーバーの今よりこれより前なら、端末の時計が遅れているとみる（通信にかかった長さと見分けるため、送る側の待つ長さより長く）
	caosClockBehind = 30 * time.Second
)

var jst = time.FixedZone("JST", 9*60*60)

type CaosHandler struct {
	db  *gorm.DB
	hub *Hub
	// 緊急（入れ直し）で増減した在庫の通知
	inventory *Inventory
	// 今の時刻（テストで差し替える）。今日の範囲と、押した時刻の無い書き込みの抽出の開始・終了の時刻に使う
	now func() time.Time
}

func NewCaosHandler(db *gorm.DB, hub *Hub, inventory *Inventory) *CaosHandler {
	return &CaosHandler{db: db, hub: hub, inventory: inventory, now: time.Now}
}

// caosToday は今日（日本時間）の始まりと終わり。CaOS は作成日時がこの間の注文だけを見る。
func caosToday(now time.Time) (time.Time, time.Time) {
	t := now.In(jst)
	start := time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, jst)
	return start, start.AddDate(0, 0, 1)
}

// ---------------------------------------------------------------- 抽出の時刻

// caosPressedAt は、画面が操作を押した時刻（press）をサーバーの時計の時刻にする（ミリ秒まで）。now はサーバーの今（ミリ秒まで）。
//   - press が無ければ（押した時刻を送らない古い画面）サーバーの今
//   - 送った時刻がサーバーの今より caosClockAhead より後か、caosClockBehind より前なら、端末の時計がずれているとみて、押した時刻をその差だけずらす
//     （押してから送るまでの長さは端末の時計どうしの差なので、ずれていても正しい）。そうでなければ押した時刻のまま
//     （同じ端末で押した開始と終了の差が、通信にかかった長さでずれないように。送った時刻が今より前なのは、通信にかかった長さかもしれない）
//   - サーバーの今より後なら今（orderCreatedAt と同じ）。今日（日本時間）より前でも今（画面は前の日に押した操作を送らない）
func caosPressedAt(press *models.CaosPress, now time.Time) time.Time {
	if press == nil {
		return now
	}
	at := press.At
	if offset := now.UnixMilli() - press.SentAt; offset < -caosClockAhead.Milliseconds() || offset > caosClockBehind.Milliseconds() {
		at += offset
	}
	t := time.UnixMilli(at)
	if today, _ := caosToday(now); t.Before(today) {
		return now
	}
	return orderCreatedAt(&t, now)
}

// caosBrewAt は、ドリッパーで抽出を始める・終える時刻。押した時刻（caosPressedAt）が、同じドリッパーで今日いちばん遅く終えた抽出より前なら、
// その終えた時刻にする（前の抽出と重ならないように）。終えた抽出が無ければ押した時刻のまま。そのドリッパーの advisory lock を取ったまま呼ぶ。
func caosBrewAt(tx *gorm.DB, dripper int, pressed, start, end time.Time) (time.Time, error) {
	var last []time.Time
	if err := tx.Raw("SELECT c.brew_finished_at FROM "+caosUnits+" c, orders o WHERE "+caosDripperWhere+
		" AND c.brew_finished_at > ? ORDER BY c.brew_finished_at DESC LIMIT 1", start, end, dripper, pressed).Scan(&last).Error; err != nil {
		return time.Time{}, err
	}
	if len(last) > 0 {
		return last[0], nil
	}
	return pressed, nil
}

// ---------------------------------------------------------------- カップの値

// caosUnits は CaOS のカードに入る行：注文のカップ（最初の抽出）と、緊急（入れ直し）。列は order_cups と同じ名前で、
// cup_id は入れ直したカップ（カップなら自分）。注文・明細・商品は入れ直したカップのもの。
// 準備完了・提供の時刻は盤面の決まりに使わないので読まない。提供へ届けた時刻（delivered_at）はドリップ完了の報告が読む。
const caosUnits = `(SELECT id, id AS cup_id, order_id, order_menu_id, item_id,
		dripper, dripper_position, drip_id, brew_started_at, brew_finished_at, delivered_at FROM order_cups
	UNION ALL SELECT e.id, e.order_cup_id, c.order_id, c.order_menu_id, c.item_id,
		e.dripper, e.dripper_position, e.drip_id, e.brew_started_at, e.brew_finished_at, e.delivered_at
	FROM cup_emergencies e JOIN order_cups c ON c.id = e.order_cup_id)`

// caosUnit はカップか入れ直しの行（caosUnits の 1 行）。OrderCup の ID は行の ID（入れ直しなら入れ直しの ID）。
// 準備完了・提供（ReadyAt・ServedAt）は読まないので、いつも nil
type caosUnit struct {
	models.OrderCup
	// 入れ直したカップ（カップなら自分）
	CupID uuid.UUID
	// 注文番号（readCaosLane だけが読む）
	OrderNo int
}

// readCaosUnits は where（c は caosUnits）に合うカップと入れ直しを読む。
func readCaosUnits(tx *gorm.DB, where string, args ...any) ([]caosUnit, error) {
	var rows []caosUnit
	err := tx.Raw("SELECT c.* FROM "+caosUnits+" c WHERE "+where, args...).Scan(&rows).Error
	return rows, err
}

// updateCaosUnits はカップと入れ直しの両方の表で、where に合う行の CaOS の列を書く（列の名前は同じ）。
func updateCaosUnits(tx *gorm.DB, values map[string]any, where string, args ...any) error {
	for _, table := range []any{&models.OrderCup{}, &models.CupEmergency{}} {
		if err := tx.Model(table).Where(where, args...).Updates(values).Error; err != nil {
			return err
		}
	}
	return nil
}

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

// validateCaosAfter は書く値の形を確かめる（400）。
func validateCaosAfter(a models.CaosCupAfter) error {
	if a.Dripper == nil {
		if a.InsertBefore != nil || a.StartBrew {
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
	if a.InsertBefore != nil && *a.InsertBefore == *a.DripId {
		return errors.New("自分のカードの前には入れられません")
	}
	if a.InsertBefore != nil && a.StartBrew {
		return errors.New("列の先頭に入れて始めるときは、前に入れるカードは決められません")
	}
	return nil
}

// caosUpdates は after を書く列。position はサーバーが決めた番号（未割当なら nil）。
// startedAt は抽出を始めるときのサーバーの今か、統合で入る抽出中のカードの開始（どちらでもなければ nil）。終了の時刻は「次へ」だけが付ける。
func caosUpdates(a models.CaosCupAfter, position *int, startedAt *time.Time) map[string]any {
	return map[string]any{
		"dripper":          a.Dripper,
		"dripper_position": position,
		"drip_id":          a.DripId,
		"brew_started_at":  startedAt,
		"brew_finished_at": nil,
	}
}

// lockCaosDrippers はカップを置くドリッパーの advisory lock を番号の順に取る（注文の行より先に取る）。
func lockCaosDrippers(tx *gorm.DB, drippers []int) error {
	for _, d := range sortedUnique(drippers, cmp.Compare) {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "caos:dripper:"+strconv.Itoa(d)).Error; err != nil {
			return err
		}
	}
	return nil
}

// sortedUnique は v を並べて重なりを除いたもの（v は変えない）。ロックは並べた順に取る
func sortedUnique[T comparable](v []T, compare func(a, b T) int) []T {
	out := slices.Clone(v)
	slices.SortFunc(out, compare)
	return slices.Compact(out)
}

// compareUUID は ID を文字列で比べる（画面の caosLane の並びと同じ比べ方）
func compareUUID(a, b uuid.UUID) int {
	return strings.Compare(a.String(), b.String())
}

// lockCaosOrders は注文の行を ID の順にロックし、カップを読む。orderIDs（書くカップの注文）は、消えていれば 409、今日の注文でなければ 400。
// extra（番号をずらすかもしれないカップと、入るカードの書かないカップの注文）もいっしょに ID の順でロックする（消えていたら飛ばす）。返すのは orderIDs の注文だけ。
// ロックは 1 回の並びで取る（2 回に分けると、ほかの書き込みと順番が逆になってデッドロックしうる）。
func lockCaosOrders(tx *gorm.DB, orderIDs, extra []uuid.UUID, start, end time.Time) (map[uuid.UUID]*models.Order, error) {
	must := make(map[uuid.UUID]bool, len(orderIDs))
	for _, id := range orderIDs {
		must[id] = true
	}
	ids := sortedUnique(slices.Concat(orderIDs, extra), compareUUID)
	orders := make(map[uuid.UUID]*models.Order, len(orderIDs))
	for _, id := range ids {
		order, err := lockOrderWith(tx, id)
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound) && !must[id]:
			continue
		case errors.Is(err, gorm.ErrRecordNotFound):
			return nil, conflictErrorf("注文が消えました（ほかの端末で削除されたかもしれません）")
		case err != nil:
			return nil, err
		case !must[id]:
			continue
		}
		if order.CreatedAt.Before(start) || !order.CreatedAt.Before(end) {
			return nil, ruleErrorf("今日の注文のカップだけ書けます")
		}
		orders[id] = &order
	}
	return orders, nil
}

// checkCaosCardNomination は 1 枚のカードのカップに、違う指名の番号（明細のドリッパーの番号）が無いかを確かめる。
// 番号の違うカップを統合すると、どのドリッパーにも置けないカードになるので断る（指名なしのカップは、どの番号のカップとも統合できる）
func checkCaosCardNomination(tx *gorm.DB, dripID uuid.UUID) error {
	var nominations int64
	if err := tx.Raw(`
		SELECT COUNT(DISTINCT m.dripper)
		FROM `+caosUnits+` c
		JOIN order_menus m ON m.id = c.order_menu_id
		WHERE c.drip_id = ?`, dripID).Scan(&nominations).Error; err != nil {
		return err
	}
	if nominations > 1 {
		return ruleErrorf("指名の違うカップは同じカードにできません")
	}
	return nil
}

// readCaosUnitItems は書くカップ（入れ直しも）の注文（ロックする注文を決めるだけ。CaOS の値はロックしてから読む）と、
// 商品（行の ID ごと。入れ直しは入れ直したカップの商品）を読む。カップのどれかが消えていれば 409。
// 後から削除した商品・種類のカップも、注文の応答と同じく読む
func readCaosUnitItems(tx *gorm.DB, cupIDs []uuid.UUID) ([]uuid.UUID, map[uuid.UUID]models.Item, error) {
	found, err := readCaosUnits(tx, "c.id IN ?", cupIDs)
	if err != nil {
		return nil, nil, err
	}
	if len(found) != len(cupIDs) {
		return nil, nil, conflictErrorf("カップが消えました（注文が編集・削除されたかもしれません）")
	}
	var orderIDs, sourceIDs []uuid.UUID
	for _, c := range found {
		orderIDs = append(orderIDs, c.OrderID)
		sourceIDs = append(sourceIDs, c.CupID)
	}
	unscoped := func(db *gorm.DB) *gorm.DB { return db.Unscoped() }
	var sources []models.OrderCup
	if err := tx.Preload("Item", unscoped).Preload("Item.ItemType", unscoped).
		Find(&sources, "id IN ?", sourceIDs).Error; err != nil {
		return nil, nil, err
	}
	sourceItem := make(map[uuid.UUID]models.Item, len(sources))
	for _, c := range sources {
		sourceItem[c.ID] = c.Item
	}
	items := make(map[uuid.UUID]models.Item, len(found))
	for _, c := range found {
		items[c.ID] = sourceItem[c.CupID]
	}
	return orderIDs, items, nil
}

// caosNominations は注文（orderIDs）の明細の指名のドリッパーの番号（明細の ID ごと。無指名は nil。自由記述 assignee だけの古い明細も指名なし）。
// 注文の行をロックしてから読む
func caosNominations(tx *gorm.DB, orderIDs []uuid.UUID) (map[uuid.UUID]*int, error) {
	var lines []models.OrderMenu
	if err := tx.Select("id", "dripper").Find(&lines, "order_id IN ?", orderIDs).Error; err != nil {
		return nil, err
	}
	nominated := make(map[uuid.UUID]*int, len(lines))
	for _, line := range lines {
		nominated[line.ID] = line.Dripper
	}
	return nominated, nil
}

// checkCaosCards は、書いたカード（dripIDs）の全部のカップ（書かなかったカップも含む）が同じ値・同じ指名で、最大 2 杯かを確かめる
func checkCaosCards(tx *gorm.DB, dripIDs []uuid.UUID) error {
	for _, id := range sortedUnique(dripIDs, compareUUID) {
		cups, err := readCaosUnits(tx, "c.drip_id = ?", id)
		if err != nil {
			return err
		}
		if len(cups) > caosMaxCups {
			return ruleErrorf("1 枚のカードは %d 杯までです", caosMaxCups)
		}
		for i := range cups {
			if !sameCaosState(&cups[i].OrderCup, caosCupState(&cups[0].OrderCup)) {
				return ruleErrorf("同じカードのカップは全部いっしょに動かしてください")
			}
			// 入れ直しは行の ID と入れ直したカップの ID が違う。入れ直しと緊急でないカップは同じカードにしない（緊急の取り消しと食い違う）
			if (cups[i].ID == cups[i].CupID) != (cups[0].ID == cups[0].CupID) {
				return ruleErrorf("緊急（入れ直し）と緊急でないカップは同じカードにできません")
			}
		}
		if err := checkCaosCardNomination(tx, id); err != nil {
			return err
		}
	}
	return nil
}

// ---------------------------------------------------------------- ドリッパーの列

// ドリッパーの中のカード（同じ drip_id のカップ）
type caosLaneCard struct {
	dripID  uuid.UUID
	cups    []caosUnit
	orderNo int
}

// ドリッパーの中の順番（同じカードのカップは同じ値）
func (c *caosLaneCard) position() int {
	if p := c.cups[0].DripperPosition; p != nil {
		return *p
	}
	return 0
}

// 今日の注文の、あるドリッパーに置いたカップ（c は order_cups、o は orders）。? は順に、今日の始まり・終わり・ドリッパー
const caosDripperWhere = `o.id = c.order_id AND o.created_at >= ? AND o.created_at < ? AND c.dripper = ?`

// caosDripperWhere のうち、まだ終わっていないカップ
const caosLaneWhere = caosDripperWhere + " AND c.brew_finished_at IS NULL"

// caosLaneWhere から、書いているカップを除く。? の最後に書いているカップの ID
const caosLaneOthersWhere = caosLaneWhere + " AND c.id NOT IN ?"

// readCaosLane はドリッパーの、今日の注文で終えていないカップを読む。
func readCaosLane(tx *gorm.DB, dripper int, start, end time.Time) ([]caosUnit, error) {
	var rows []caosUnit
	err := tx.Raw("SELECT c.*, o.order_id AS order_no FROM "+caosUnits+" c, orders o WHERE "+caosLaneWhere,
		start, end, dripper).Scan(&rows).Error
	return rows, err
}

// splitCaosLane はドリッパーのカップを、抽出中のカードと待機のカード（先頭から順に）に分ける。
// 画面の caosLane（modules/common/src/lib/caos-board.ts。buildCaosCards の状態と compareQueued の並び）と同じ決まり：
//   - 終了の時刻があるカードは終わり（どちらにも入れない）
//   - 開始の時刻があれば抽出中、無ければ待機
//   - 待機の並びは dripper_position・いちばん小さい注文番号・drip_id の順
//
// 同じ入力で同じ結果になることを、両方のテストが modules/common/src/lib/caos-lane-cases.json で確かめる。
func splitCaosLane(rows []caosUnit) (brewing, queued []*caosLaneCard) {
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
		switch {
		case first.BrewFinishedAt != nil:
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
			compareUUID(a.dripID, b.dripID),
		)
	})
	return brewing, queued
}

// ---------------------------------------------------------------- 順番

// caosPlace は、書くカップを置く番号と、入るカードの抽出の開始の時刻（統合で抽出中のカードに入るときだけ。ほかは nil）
type caosPlace struct {
	position  int
	startedAt *time.Time
}

// placeCaosCups は、書くカップ（w.CupIds）を w.After.Dripper に置く番号を決める。番号をずらしたカップの注文も返す。
//   - drip_id がほかのカップ（この書き込みに入っていないもの）と同じなら、そのカードに入る（統合）。番号と抽出の開始の時刻はそのカードと同じ。
//     ずらさない。抽出中のカードにも入れる（終わったカードには入れない）
//   - insert_before が無ければ最後：そのドリッパーの終わっていないカップの最大＋1（無ければ 1）。ずらさない
//   - insert_before があれば、そのカード（そのドリッパーの待機）の番号 p に入れる。番号が p 以上の終わっていないカップを全部 +1 する（UPDATE 1 文）
//
// 抜けたカードの番号は空いたままにし、全部の振り直しはしない。呼ぶ前に、そのドリッパーの advisory lock と、
// ずらすカップの注文の行のロックを取っておく（writeCups）。
func placeCaosCups(tx *gorm.DB, w models.CaosCupsWrite, start, end time.Time) (caosPlace, []uuid.UUID, error) {
	dripper := *w.After.Dripper
	joined, err := readCaosUnits(tx, "c.drip_id = ? AND c.id NOT IN ?", *w.After.DripId, w.CupIds)
	if err != nil {
		return caosPlace{}, nil, err
	}
	if len(joined) > 0 {
		switch {
		case w.After.InsertBefore != nil:
			return caosPlace{}, nil, ruleErrorf("ほかのカードに入れるときは、前に入れるカードは決められません")
		case joined[0].BrewFinishedAt != nil:
			return caosPlace{}, nil, ruleErrorf("終わったカードには入れられません")
		case joined[0].DripperPosition == nil:
			return caosPlace{}, nil, ruleErrorf("同じカードのカップは全部いっしょに動かしてください")
		}
		return caosPlace{position: *joined[0].DripperPosition, startedAt: joined[0].BrewStartedAt}, nil, nil
	}

	if w.After.InsertBefore == nil {
		var last int
		err := tx.Raw("SELECT COALESCE(MAX(c.dripper_position), 0) + 1 FROM "+caosUnits+" c, orders o WHERE "+caosLaneOthersWhere,
			start, end, dripper, w.CupIds).Scan(&last).Error
		return caosPlace{position: last}, nil, err
	}

	var found []int
	if err := tx.Raw("SELECT c.dripper_position FROM "+caosUnits+" c, orders o WHERE "+caosLaneOthersWhere+
		" AND c.drip_id = ? AND c.brew_started_at IS NULL AND c.dripper_position IS NOT NULL LIMIT 1",
		start, end, dripper, w.CupIds, *w.After.InsertBefore).Scan(&found).Error; err != nil {
		return caosPlace{}, nil, err
	}
	if len(found) == 0 {
		return caosPlace{}, nil, conflictErrorf("前に入れるカードが、そのドリッパーの待機にありません（ほかの端末で動いたかもしれません）")
	}
	p := found[0]
	var behind []caosUnit
	if err := tx.Raw("SELECT c.id, c.order_id FROM "+caosUnits+" c, orders o WHERE "+caosLaneOthersWhere+" AND c.dripper_position >= ?",
		start, end, dripper, w.CupIds, p).Scan(&behind).Error; err != nil {
		return caosPlace{}, nil, err
	}
	if len(behind) == 0 {
		return caosPlace{position: p}, nil, nil
	}
	var ids, shifted []uuid.UUID
	for _, r := range behind {
		ids = append(ids, r.ID)
		shifted = append(shifted, r.OrderID)
	}
	err = updateCaosUnits(tx, map[string]any{"dripper_position": gorm.Expr("dripper_position + 1")}, "id IN ?", ids)
	return caosPlace{position: p}, shifted, err
}

// requireCaosStartable は、書く前のドリッパーで抽出を始めてよいかを確かめる（400）。抽出中のカードがあれば（先頭に入れ、同じ書き込みで待機に下げる）、
// または cupIDs（書くカップ）のほかに待機のカードが無ければ始められる。抽出中が無く待機のある列は、待機の先頭を飛ばさず「次へ」で始める
// （画面の assignWrites と同じ決まり）。書く前に、そのドリッパーの advisory lock を取ったまま呼ぶ（writeCups）。
func requireCaosStartable(tx *gorm.DB, drippers []int, cupIDs []uuid.UUID, start, end time.Time) error {
	for _, d := range sortedUnique(drippers, cmp.Compare) {
		rows, err := readCaosLane(tx, d, start, end)
		if err != nil {
			return err
		}
		brewing, queued := splitCaosLane(rows)
		others := slices.ContainsFunc(queued, func(card *caosLaneCard) bool {
			return slices.ContainsFunc(card.cups, func(r caosUnit) bool { return !slices.Contains(cupIDs, r.ID) })
		})
		if len(brewing) == 0 && others {
			return ruleErrorf("%d 番のドリッパーには待機のカードがあるので、抽出は「次へ」で待機の先頭から始めてください", d)
		}
	}
	return nil
}

// caosBrewingTwice は、drippers のうち抽出中のカードが 2 枚以上あるドリッパーを返す（無ければ 0）。抽出中は「次へ」と同じ決まりで数える（splitCaosLane）。
// 書いたあとに、そのドリッパーの advisory lock を取ったまま呼ぶ（PUT）。
func caosBrewingTwice(tx *gorm.DB, drippers []int, start, end time.Time) (int, error) {
	for _, d := range sortedUnique(drippers, cmp.Compare) {
		rows, err := readCaosLane(tx, d, start, end)
		if err != nil {
			return 0, err
		}
		if brewing, _ := splitCaosLane(rows); len(brewing) > 1 {
			return d, nil
		}
	}
	return 0, nil
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
// 抽出を始める書き込みの brew_started_at は、押した時刻（press。caosBrewAt）。始めない書き込みは brew_started_at を消す（抽出中のカードは待機・未割当に戻る）。
func (h *CaosHandler) writeCups(writes []models.CaosCupsWrite, press *models.CaosPress) ([]uuid.UUID, error) {
	now := h.now().Truncate(time.Millisecond)
	pressed := caosPressedAt(press, now)
	start, end := caosToday(now)
	var cupIDs, dripIDs []uuid.UUID
	var placing, inserting, starting []int
	for _, w := range writes {
		cupIDs = append(cupIDs, w.CupIds...)
		if w.After.DripId != nil {
			dripIDs = append(dripIDs, *w.After.DripId)
		}
		if w.After.Dripper != nil {
			placing = append(placing, *w.After.Dripper)
		}
		if w.After.InsertBefore != nil {
			inserting = append(inserting, *w.After.Dripper)
		}
		if w.After.StartBrew {
			starting = append(starting, *w.After.Dripper)
		}
	}
	var orderIDs []uuid.UUID
	err := h.db.Transaction(func(tx *gorm.DB) error {
		orderIDs = nil
		if err := lockCaosDrippers(tx, placing); err != nil {
			return err
		}
		lockIDs, itemOf, err := readCaosUnitItems(tx, cupIDs)
		if err != nil {
			return err
		}
		// 書かないカップの注文もロックする：
		//   - 途中に入れるドリッパーの終わっていないカップ。番号を +1 するので（注文の編集はカップを同じ値で入れ直すので、
		//     ロックせずにずらすと、ずらした番号が消えうる）。列に入るのは advisory lock を取った CaOS の書き込みだけなので、ここで読んだより増えない
		//   - 入るカード（after の drip_id）のカップ。下でそのカードの全部のカップを確かめるので（未割当のカードには advisory lock が無い）
		var extra []uuid.UUID
		if err := tx.Raw("SELECT c.order_id FROM "+caosUnits+" c WHERE c.drip_id IN ? OR (c.dripper IN ? AND c.brew_finished_at IS NULL)",
			dripIDs, inserting).Scan(&extra).Error; err != nil {
			return err
		}
		orders, err := lockCaosOrders(tx, lockIDs, extra, start, end)
		if err != nil {
			return err
		}
		changed := map[uuid.UUID]bool{}
		for id := range orders {
			changed[id] = true
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
		for _, c := range locked {
			lockedByID[c.ID] = c
		}

		if err := requireCaosStartable(tx, starting, cupIDs, start, end); err != nil {
			return err
		}
		for _, w := range writes {
			for _, id := range w.CupIds {
				cup, ok := lockedByID[id]
				if !ok {
					return conflictErrorf("カップが消えました（注文が編集されたかもしれません）")
				}
				item := itemOf[id]
				if !sameCaosState(&cup.OrderCup, w.Before) {
					return conflictErrorf("ほかの端末で先に変わりました。もう一度操作してください")
				}
				if (w.After.Dripper != nil || w.After.DripId != nil) && !item.ItemType.BrewRequired() {
					return ruleErrorf("抽出の要らないカップ（%s）はドリッパーに置けません", item.Name)
				}
				if n := nominated[cup.OrderMenuID]; w.After.Dripper != nil && n != nil && *n != *w.After.Dripper {
					return ruleErrorf("指名のあるカップは %d 番のドリッパーにしか置けません", *n)
				}
			}
			// 終わったカード（終了の時刻がある）は動かさない（終えるのは「次へ」）。
			// 抽出中のカードは動かせる（始めた時刻を消すか、start_brew なら今から始め直す）が、ほかのカードには統合せず、分けない
			if w.Before.BrewStartedAt != nil {
				if err := checkCaosStartedMove(tx, w); err != nil {
					return err
				}
			}
			var position *int
			var startedAt *time.Time
			if w.After.StartBrew {
				at, err := caosBrewAt(tx, *w.After.Dripper, pressed, start, end)
				if err != nil {
					return err
				}
				startedAt = &at
			}
			if w.After.Dripper != nil {
				place, shifted, err := placeCaosCups(tx, w, start, end)
				if err != nil {
					return err
				}
				position = &place.position
				if place.startedAt != nil {
					startedAt = place.startedAt
				}
				for _, id := range shifted {
					changed[id] = true
				}
			}
			if err := updateCaosUnits(tx, caosUpdates(w.After, position, startedAt), "id IN ?", w.CupIds); err != nil {
				return err
			}
		}

		if err := checkCaosCards(tx, dripIDs); err != nil {
			return err
		}
		// 抽出を始めたドリッパーで、抽出中は 1 枚だけ（先頭に入れるなら、抽出中だったカードを同じ書き込みで待機に下げる。画面の assignWrites）
		d, err := caosBrewingTwice(tx, starting, start, end)
		if err != nil {
			return err
		}
		if d != 0 {
			return ruleErrorf("%d 番のドリッパーはもう抽出中です", d)
		}
		for id := range changed {
			orderIDs = append(orderIDs, id)
		}
		return nil
	})
	return orderIDs, err
}

// checkCaosStartedMove は、抽出を始めたカード（抽出中・終わり。w.Before に始めた時刻がある）を動かす書き込みを確かめる（400）。
// 抽出中のカードは、ほかのカードに統合せず、カップを全部いっしょに動かす（統合の解除は待機・未割当のカードだけ）。
func checkCaosStartedMove(tx *gorm.DB, w models.CaosCupsWrite) error {
	switch {
	case w.Before.BrewFinishedAt != nil:
		return ruleErrorf("終わったカードは動かせません")
	case w.After.DripId != nil && !ptrEqual(w.After.DripId, w.Before.DripId):
		return ruleErrorf("抽出中のカードの drip_id は変えられません（ほかのカードに統合もできません）")
	}
	rest, err := readCaosUnits(tx, "c.drip_id = ? AND c.id NOT IN ?", w.Before.DripId, w.CupIds)
	if err != nil {
		return err
	}
	if len(rest) > 0 {
		return ruleErrorf("抽出中のカードは分けられません（カップを全部いっしょに動かしてください）")
	}
	return nil
}

// checkCaosDripper はドリッパーの番号が 1〜caosDrippers かを確かめる（400）。
func checkCaosDripper(dripper int) error {
	if dripper < 1 || dripper > caosDrippers {
		return ruleErrorf("ドリッパーは 1〜%d です", caosDrippers)
	}
	return nil
}

// caosDripperParam はパスのドリッパーの番号を読む。違えば 400 を書いて false。
func caosDripperParam(c *gin.Context) (int, bool) {
	dripper, err := strconv.Atoi(c.Param("dripper"))
	if err != nil {
		dripper = 0
	}
	return dripper, !respondError(c, checkCaosDripper(dripper))
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
	orderIDs, err := h.writeCups(req.Writes, req.Press)
	h.respond(c, orderIDs, err)
}

// ---------------------------------------------------------------- 「次へ」

// advance は「次へ」を 1 回行う（req）。drip_id は終えるカード（画面が抽出中と見ているカード。nil なら待機の先頭を始めるだけ）。
// start_next が false なら終えるだけで、待機の先頭は始めない（抽出中のカードを押したとき。省略は true）。
// start_drip_id があれば、待機の先頭がそのカードのときだけ始める（押した待機のカードを始めるとき）。書いた注文を返す。
// 書くのは抽出の時刻（終えるカードの brew_finished_at と、始めるカードの brew_started_at）だけで、カップの準備完了は変えない。
// 時刻は押した時刻（press。caosBrewAt）。始めてから caosNextCooldown は、始めた時刻と押した時刻の差で見る。
func (h *CaosHandler) advance(dripper int, req models.CaosNextRequest) ([]uuid.UUID, error) {
	seen := req.DripId
	startNext := req.StartNext == nil || *req.StartNext
	now := h.now().Truncate(time.Millisecond)
	pressed := caosPressedAt(req.Press, now)
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
			brewing = brewing[1:]
		}
		switch {
		case seen != nil && (cur == nil || cur.dripID != *seen):
			return conflictErrorf("このカードはもう終わっています（ほかの端末で「次へ」を押したかもしれません）")
		case seen == nil && cur != nil:
			return conflictErrorf("抽出中のカードがあります（画面が古いかもしれません）")
		case cur != nil && pressed.Sub(*cur.cups[0].BrewStartedAt) < caosNextCooldown:
			return ruleErrorf("始めてから %d 秒は「次へ」を押せません", int(caosNextCooldown/time.Second))
		}
		if startNext && len(queued) > 0 && len(brewing) == 0 {
			head = queued[0]
		}
		switch {
		case cur == nil && !startNext:
			return conflictErrorf("このドリッパーには抽出中のカードがありません")
		case cur == nil && head == nil:
			return conflictErrorf("このドリッパーには抽出中・待機のカードがありません")
		case req.StartDripId != nil && (head == nil || head.dripID != *req.StartDripId):
			return conflictErrorf("押したカードが待機の先頭ではありません（ほかの端末で並びが変わったかもしれません）")
		}
		at, err := caosBrewAt(tx, dripper, pressed, start, end)
		if err != nil {
			return err
		}

		// 終えるカードと始めるカードのカップ
		var cups []caosUnit
		var lockIDs, unitIDs []uuid.UUID
		for _, card := range []*caosLaneCard{cur, head} {
			if card != nil {
				cups = append(cups, card.cups...)
			}
		}
		for _, r := range cups {
			lockIDs = append(lockIDs, r.OrderID)
			unitIDs = append(unitIDs, r.ID)
		}
		orders, err := lockCaosOrders(tx, lockIDs, nil, start, end)
		if err != nil {
			return err
		}
		// ロックする前に読んだカップが、そのままか
		locked, err := readCaosUnits(tx, "c.id IN ?", unitIDs)
		if err != nil {
			return err
		}
		for _, r := range cups {
			i := slices.IndexFunc(locked, func(c caosUnit) bool { return c.ID == r.ID })
			if i < 0 || !sameCaosState(&locked[i].OrderCup, caosCupState(&r.OrderCup)) {
				return errConflict
			}
		}

		if cur != nil {
			// 終えるのは抽出だけ。カップの準備完了（ready_at）は提供の画面で付ける
			if err := updateCaosUnits(tx, map[string]any{"brew_finished_at": at}, "drip_id = ?", cur.dripID); err != nil {
				return err
			}
		}
		if head != nil {
			if err := updateCaosUnits(tx, map[string]any{"brew_started_at": at}, "drip_id = ?", head.dripID); err != nil {
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
	dripper, ok := caosDripperParam(c)
	if !ok {
		return
	}
	var req models.CaosNextRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	orderIDs, err := h.advanceRetrying(dripper, req)
	h.respond(c, orderIDs, err)
}

// advanceRetrying は advance を、ロックする前に読んだカップが変わっていた（注文の編集などと重なった）ときだけ読み直して行う。
func (h *CaosHandler) advanceRetrying(dripper int, req models.CaosNextRequest) ([]uuid.UUID, error) {
	for range caosAttempts {
		orderIDs, err := h.advance(dripper, req)
		if err != errConflict {
			return orderIDs, err
		}
	}
	return nil, conflictErrorf("注文の変更と重なりました。もう一度押してください")
}

// ---------------------------------------------------------------- 応答と配信

// respond は err を応答に書く。無ければ 204 を返してから、書いた注文を配る（publish）。
func (h *CaosHandler) respond(c *gin.Context, orderIDs []uuid.UUID, err error) {
	if respondError(c, err) {
		return
	}
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
	h.publish(orderIDs)
}

// publish は書いた注文を配る（応答を書いてから呼ぶ）。
func (h *CaosHandler) publish(orderIDs []uuid.UUID) {
	for _, id := range orderIDs {
		if _, err := publishOrder(h.db, h.hub, id); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("caos: failed to publish order %s: %v", id, err)
		}
	}
}
