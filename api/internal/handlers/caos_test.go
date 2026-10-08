package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// CaOS の書き込みの DB のテスト。注文の DB と同じく LISTEN_TEST_DATABASE_URL を渡したときだけ走る（openListenTestDB）。

type caosFixture struct {
	db     *gorm.DB
	hub    *Hub
	caos   *CaosHandler
	orders *OrderHandler
	blend  models.Item
	milk   models.Item
	menu   models.Menu
}

func newCaosFixture(t *testing.T, db *gorm.DB) *caosFixture {
	t.Helper()
	hub := NewHub()
	// Run しないので、配信は hub.broadcast に溜まる。溜まりすぎて止まらないよう読み捨てる
	go func() {
		for range hub.broadcast {
		}
	}()
	f := &caosFixture{db: db, hub: hub, caos: NewCaosHandler(db, hub), orders: NewOrderHandler(db, hub, nil)}
	// 抽出が要るかは種類の項目で決める（名前は見ない）
	hot := models.ItemType{Name: "hot", DisplayName: "ホット"}
	milk := models.ItemType{Name: "milk", DisplayName: "ミルク", NeedsBrew: boolPtr(false)}
	f.blend = models.Item{Name: "ブレンド", Abbr: "ブ", ItemType: hot}
	f.milk = models.Item{Name: "アイスミルク", Abbr: "ミ", ItemType: milk}
	f.menu = models.Menu{Name: "ブレンド", Abbr: "ブ", Price: 500, Key: "blend-" + uuid.NewString()}
	for _, v := range []any{&f.blend, &f.milk, &f.menu} {
		if err := db.Create(v).Error; err != nil {
			t.Fatal(err)
		}
	}
	return f
}

// 注文の明細（カップの商品と指名）
type caosLine struct {
	items    []models.Item
	assignee *string
}

func line(items ...models.Item) caosLine { return caosLine{items: items} }

// createOrderAt は注文番号 no の注文を作る。
func (f *caosFixture) createOrderAt(t *testing.T, no int, createdAt time.Time, lines ...caosLine) models.Order {
	t.Helper()
	order := models.Order{ID: uuid.New(), OrderId: no, CreatedAt: createdAt, BillingAmount: 500, Received: 500}
	pos := 0
	for _, l := range lines {
		m := models.OrderMenu{ID: uuid.New(), OrderID: order.ID, MenuID: f.menu.ID, MenuName: f.menu.Name, UnitPrice: 500, Assignee: l.assignee}
		order.OrderMenus = append(order.OrderMenus, m)
		for _, item := range l.items {
			order.OrderCups = append(order.OrderCups, models.OrderCup{ID: uuid.New(), OrderMenuID: m.ID, ItemID: item.ID, Position: pos})
			pos++
		}
	}
	if err := f.db.Omit("OrderCups.Item", "OrderMenus.Menu").Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	return order
}

func (f *caosFixture) createOrder(t *testing.T, no int, lines ...caosLine) models.Order {
	t.Helper()
	return f.createOrderAt(t, no, time.Now(), lines...)
}

func (f *caosFixture) cup(t *testing.T, id uuid.UUID) models.OrderCup {
	t.Helper()
	var cup models.OrderCup
	if err := f.db.First(&cup, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return cup
}

// state は DB の今のカップの値（before に送る）。
func (f *caosFixture) state(t *testing.T, id uuid.UUID) map[string]any {
	t.Helper()
	cup := f.cup(t, id)
	return stateJSON(cupCaosState(&cup))
}

func stateJSON(s caosState) map[string]any {
	return map[string]any{"dripper": s.Dripper, "dripper_position": s.DripperPosition, "drip_id": s.DripID,
		"brew_started_at": s.BrewStartedAt, "brew_finished_at": s.BrewFinishedAt}
}

var unassigned = map[string]any{"dripper": nil, "dripper_position": nil, "drip_id": nil, "brew_started_at": nil, "brew_finished_at": nil}

// placed はドリッパーに置いた値。start が nil なら待機
func placed(dripper int, position float64, dripID uuid.UUID, start *time.Time) map[string]any {
	return map[string]any{"dripper": dripper, "dripper_position": position, "drip_id": dripID, "brew_started_at": start, "brew_finished_at": nil}
}

func write(cups []uuid.UUID, before, after map[string]any) map[string]any {
	return map[string]any{"cup_ids": cups, "before": before, "after": after}
}

// put は PUT /api/caos/cups を呼び、状態コードとエラーを返す。
func (f *caosFixture) put(t *testing.T, writes ...map[string]any) (int, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"writes": writes})
	w := callHandler(t, f.caos.WriteCaosCups, http.MethodPut, string(body))
	return w.Code, w.Body.String()
}

func (f *caosFixture) mustPut(t *testing.T, writes ...map[string]any) {
	t.Helper()
	if code, body := f.put(t, writes...); code != http.StatusNoContent {
		t.Fatalf("PUT /api/caos/cups = %d: %s", code, body)
	}
}

// next は「次へ」を呼ぶ。
func (f *caosFixture) next(t *testing.T, dripper int, seen *uuid.UUID) (int, models.CaosNextResult) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"drip_id": seen})
	w := callWithParams(t, f.caos.AdvanceCaosDripper, http.MethodPost, string(body), gin.Params{{Key: "dripper", Value: fmt.Sprint(dripper)}})
	var res models.CaosNextResult
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, res
}

// ハンドラを呼ぶ（パスの引数つき）
func callWithParams(t *testing.T, handler gin.HandlerFunc, method, body string, params gin.Params) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = params
	handler(c)
	return w
}

func ids(cups ...models.OrderCup) []uuid.UUID {
	out := make([]uuid.UUID, len(cups))
	for i, c := range cups {
		out[i] = c.ID
	}
	return out
}

func strPtr(s string) *string { return &s }

func TestCaosWriteCupsOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend, f.blend), line(f.milk))
	o2 := f.createOrder(t, 2, caosLine{items: []models.Item{f.blend}, assignee: strPtr(" ２ ")})
	o3 := f.createOrder(t, 3, line(f.blend))
	card1 := uuid.New()
	start := time.Now().Add(-time.Minute)

	// 割当：2 杯を 1 枚のカードで、空いているドリッパー 1 で始める
	f.mustPut(t, write(ids(o1.OrderCups[:2]...), unassigned, placed(1, 1, card1, &start)))
	for _, c := range o1.OrderCups[:2] {
		cup := f.cup(t, c.ID)
		if cup.Dripper == nil || *cup.Dripper != 1 || cup.DripID == nil || *cup.DripID != card1 || cup.BrewStartedAt == nil {
			t.Fatalf("cup = %+v", cup)
		}
	}
	// 注文の応答に載る
	var order models.Order
	if err := preloadOrder(db).First(&order, "id = ?", o1.ID).Error; err != nil {
		t.Fatal(err)
	}
	if resp := toOrderResponse(&order); resp.Cups[0].Dripper == nil || resp.Cups[0].DripId == nil || resp.Cups[2].Dripper != nil {
		t.Fatalf("cups in the response = %+v", resp.Cups)
	}

	// 楽観ロック：書く前の値が今と違えば 409（ほかの端末が先に書いた）
	if code, _ := f.put(t, write(ids(o1.OrderCups[:2]...), unassigned, placed(2, 1, card1, nil))); code != http.StatusConflict {
		t.Fatalf("stale before = %d, want 409", code)
	}
	// 時刻はミリ秒までで比べる（画面の Date はミリ秒まで）
	before := f.state(t, o1.OrderCups[0].ID)
	before["brew_started_at"] = f.cup(t, o1.OrderCups[0].ID).BrewStartedAt.Add(500 * time.Microsecond)
	f.mustPut(t, write(ids(o1.OrderCups[:2]...), before, placed(1, 1, card1, &start)))

	// 抽出が要らないカップはドリッパーにもカードにも入れられない
	if code, _ := f.put(t, write(ids(o1.OrderCups[2]), unassigned, placed(3, 1, uuid.New(), nil))); code != http.StatusUnprocessableEntity {
		t.Fatalf("milk on a dripper = %d, want 422", code)
	}
	if code, _ := f.put(t, write(ids(o1.OrderCups[2]), unassigned, map[string]any{"dripper": nil, "dripper_position": nil, "drip_id": uuid.New(), "brew_started_at": nil, "brew_finished_at": nil})); code != http.StatusUnprocessableEntity {
		t.Fatalf("milk in a card = %d, want 422", code)
	}

	// 指名の番号のあるカップは、その番号のドリッパーにしか置けない
	if code, _ := f.put(t, write(ids(o2.OrderCups[0]), unassigned, placed(1, 2, uuid.New(), nil))); code != http.StatusUnprocessableEntity {
		t.Fatalf("nominated cup on another dripper = %d, want 422", code)
	}
	f.mustPut(t, write(ids(o2.OrderCups[0]), unassigned, placed(2, 2, uuid.New(), nil)))

	// 1 つのドリッパーで抽出中は 1 枚だけ。待機なら置ける
	card3 := uuid.New()
	if code, _ := f.put(t, write(ids(o3.OrderCups[0]), unassigned, placed(1, 3, card3, &start))); code != http.StatusUnprocessableEntity {
		t.Fatalf("second brewing card = %d, want 422", code)
	}
	f.mustPut(t, write(ids(o3.OrderCups[0]), unassigned, placed(1, 3, card3, nil)))

	// 1 枚のカードは 2 杯まで。同じカードのカップは全部いっしょに動かす
	if code, _ := f.put(t, write(ids(o3.OrderCups[0]), f.state(t, o3.OrderCups[0].ID), placed(1, 1, card1, &start))); code != http.StatusUnprocessableEntity {
		t.Fatalf("third cup in a card = %d, want 422", code)
	}
	if code, _ := f.put(t, write(ids(o3.OrderCups[0]), f.state(t, o3.OrderCups[0].ID), placed(1, 1, card1, nil))); code != http.StatusUnprocessableEntity {
		t.Fatalf("third cup in a card = %d, want 422", code)
	}

	// まとめた書き込みは、どれか 1 つが通らなければ何も書かない
	if code, _ := f.put(t,
		write(ids(o3.OrderCups[0]), f.state(t, o3.OrderCups[0].ID), unassigned),
		write(ids(o1.OrderCups[2]), unassigned, placed(4, 1, uuid.New(), nil)),
	); code != http.StatusUnprocessableEntity {
		t.Fatalf("partly invalid writes = %d, want 422", code)
	}
	if cup := f.cup(t, o3.OrderCups[0].ID); cup.Dripper == nil {
		t.Fatal("the valid write of a failed request was saved")
	}

	// 未割当に戻す
	f.mustPut(t, write(ids(o3.OrderCups[0]), f.state(t, o3.OrderCups[0].ID), unassigned))
	if cup := f.cup(t, o3.OrderCups[0].ID); cup.Dripper != nil || cup.DripID != nil {
		t.Fatalf("cup = %+v, want unassigned", cup)
	}

	// 注文を編集しても、引き継いだカップは同じ値のまま。新しい明細のカップは未割当
	edit := models.OrderUpdateRequest{OrderId: 1, BillingAmount: 1100, Received: 1100, MenuIds: []models.MenuInfoCreate{
		{MenuId: f.menu.ID, OrderMenuId: &o1.OrderMenus[0].ID}, {MenuId: f.menu.ID, OrderMenuId: &o1.OrderMenus[1].ID},
	}}
	body, _ := json.Marshal(edit)
	if w := callWithParams(t, f.orders.UpdateOrder, http.MethodPut, string(body), gin.Params{{Key: "id", Value: o1.ID.String()}}); w.Code != http.StatusOK {
		t.Fatalf("PUT order = %d: %s", w.Code, w.Body)
	}
	if cup := f.cup(t, o1.OrderCups[1].ID); cup.DripID == nil || *cup.DripID != card1 || cup.BrewStartedAt == nil {
		t.Fatalf("cup after edit = %+v", cup)
	}

	// 前の日の注文のカップは書けない
	old := f.createOrderAt(t, 9, time.Now().Add(-48*time.Hour), line(f.blend))
	if code, _ := f.put(t, write(ids(old.OrderCups[0]), unassigned, placed(5, 1, uuid.New(), nil))); code != http.StatusUnprocessableEntity {
		t.Fatalf("yesterday's cup = %d, want 422", code)
	}

	// 消えたカップは 409、形の違うリクエストは 400
	if code, _ := f.put(t, write([]uuid.UUID{uuid.New()}, unassigned, placed(5, 1, uuid.New(), nil))); code != http.StatusConflict {
		t.Fatalf("missing cup = %d, want 409", code)
	}
	for name, after := range map[string]map[string]any{
		"dripper 7":       placed(7, 1, uuid.New(), nil),
		"no drip_id":      {"dripper": 1, "dripper_position": 1, "drip_id": nil, "brew_started_at": nil, "brew_finished_at": nil},
		"finished only":   {"dripper": 1, "dripper_position": 1, "drip_id": uuid.New(), "brew_started_at": nil, "brew_finished_at": time.Now()},
		"time unassigned": {"dripper": nil, "dripper_position": nil, "drip_id": nil, "brew_started_at": time.Now(), "brew_finished_at": nil},
	} {
		if code, _ := f.put(t, write(ids(o3.OrderCups[0]), unassigned, after)); code != http.StatusBadRequest {
			t.Fatalf("%s = %d, want 400", name, code)
		}
	}
	if code, _ := f.put(t); code != http.StatusBadRequest {
		t.Fatalf("no writes = %d, want 400", code)
	}
}

func TestCaosNextOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend, f.blend), line(f.milk))
	o2 := f.createOrder(t, 2, line(f.blend))
	o3 := f.createOrder(t, 3, line(f.blend))
	card1, card2, card3 := uuid.New(), uuid.New(), uuid.New()
	start := time.Now().Add(-time.Minute)
	f.mustPut(t,
		write(ids(o1.OrderCups[:2]...), unassigned, placed(1, 1, card1, &start)),
		write(ids(o2.OrderCups[0]), unassigned, placed(1, 2, card2, nil)),
		// 間に入れた順番（注文番号より前）
		write(ids(o3.OrderCups[0]), unassigned, placed(1, 1.5, card3, nil)),
	)

	// 次へ：抽出中のカードを終え、そのカップだけ準備完了にし、待機の先頭（順番の小さいもの）を始める
	code, res := f.next(t, 1, &card1)
	if code != http.StatusOK || res.FinishedDripId == nil || uuid.UUID(*res.FinishedDripId) != card1 ||
		res.StartedDripId == nil || uuid.UUID(*res.StartedDripId) != card3 {
		t.Fatalf("next = %d %+v", code, res)
	}
	for _, c := range o1.OrderCups[:2] {
		if cup := f.cup(t, c.ID); cup.ReadyAt == nil || cup.BrewFinishedAt == nil {
			t.Fatalf("cup = %+v, want ready and finished", cup)
		}
	}
	if cup := f.cup(t, o1.OrderCups[2].ID); cup.ReadyAt != nil {
		t.Fatal("milk got ready")
	}
	var order models.Order
	if err := db.First(&order, "id = ?", o1.ID).Error; err != nil || order.ReadyAt != nil {
		t.Fatalf("order = %+v, want not ready (the milk is left)", order)
	}
	if cup := f.cup(t, o3.OrderCups[0].ID); cup.BrewStartedAt == nil {
		t.Fatal("the next card did not start")
	}

	// 同じカードの「次へ」をもう一度押しても、次のカードは終わらせない。抽出中があるのに無いと見ていても断る
	if code, _ := f.next(t, 1, &card1); code != http.StatusConflict {
		t.Fatalf("second next = %d, want 409", code)
	}
	if code, _ := f.next(t, 1, nil); code != http.StatusConflict {
		t.Fatalf("next without the brewing card = %d, want 409", code)
	}

	// マスターでカップを準備完了にしたカードは終わりとみなし、「次へ」は待機の先頭を始めるだけ
	if w := callWithParams(t, f.orders.MarkOrderCupReady, http.MethodPatch, "", gin.Params{{Key: "id", Value: o3.ID.String()}, {Key: "cupId", Value: o3.OrderCups[0].ID.String()}}); w.Code != http.StatusOK {
		t.Fatalf("PATCH cup ready = %d", w.Code)
	}
	code, res = f.next(t, 1, nil)
	if code != http.StatusOK || res.FinishedDripId != nil || res.StartedDripId == nil || uuid.UUID(*res.StartedDripId) != card2 {
		t.Fatalf("next after the master = %d %+v", code, res)
	}
	// 抽出中のカードを準備完了にしたカードの列に、抽出中のカードを置ける（終わりとみなす）
	f.mustPut(t, write(ids(o2.OrderCups[0]), f.state(t, o2.OrderCups[0].ID), unassigned))
	if code, body := f.put(t, write(ids(o2.OrderCups[0]), unassigned, placed(1, 2, card2, &start))); code != http.StatusNoContent {
		t.Fatalf("brewing after the master = %d: %s", code, body)
	}
	if code, _ := f.next(t, 1, &card2); code != http.StatusOK {
		t.Fatalf("next = %d", code)
	}
	// 何も無いドリッパー・形の違う番号
	if code, _ := f.next(t, 1, nil); code != http.StatusConflict {
		t.Fatalf("next on an empty dripper = %d, want 409", code)
	}
	if code, _ := f.next(t, 7, nil); code != http.StatusBadRequest {
		t.Fatalf("next on dripper 7 = %d, want 400", code)
	}

	// 前の日の注文のカップは見ない（終わっていない抽出中が残っていても、今日の盤面は空）
	old := f.createOrderAt(t, 9, time.Now().Add(-48*time.Hour), line(f.blend))
	if err := db.Model(&models.OrderCup{}).Where("id = ?", old.OrderCups[0].ID).
		Updates(placedState(2, uuid.New(), &start).updates()).Error; err != nil {
		t.Fatal(err)
	}
	if code, _ := f.next(t, 2, nil); code != http.StatusConflict {
		t.Fatalf("next with yesterday's card = %d, want 409", code)
	}
	f.mustPut(t, write(ids(o1.OrderCups[2]), unassigned, unassigned)) // 何も変えない書き込みも通る
}

func placedState(dripper int, id uuid.UUID, start *time.Time) caosState {
	pos := 1.0
	return caosState{Dripper: &dripper, DripperPosition: &pos, DripID: &id, BrewStartedAt: start}
}

func TestCaosConcurrentWrites(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	var orders []models.Order
	for no := 1; no <= 6; no++ {
		orders = append(orders, f.createOrder(t, no, line(f.blend)))
	}
	start := time.Now()

	// 6 台が同時に、別のカードを空いているドリッパー 2 で始めようとする：通るのは 1 枚だけ（ほかは 422）
	var wg sync.WaitGroup
	codes := make([]int, len(orders))
	for i, o := range orders {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i], _ = f.put(t, write(ids(o.OrderCups[0]), unassigned, placed(2, float64(i), uuid.New(), &start)))
		}()
	}
	wg.Wait()
	ok := 0
	for _, code := range codes {
		switch code {
		case http.StatusNoContent:
			ok++
		case http.StatusUnprocessableEntity:
		default:
			t.Fatalf("PUT = %d", code)
		}
	}
	if ok != 1 {
		t.Fatalf("%d brewing cards were written, want 1", ok)
	}
	var brewingID uuid.UUID
	var rest []models.Order
	for i, o := range orders {
		if codes[i] == http.StatusNoContent {
			brewingID = *f.cup(t, o.OrderCups[0].ID).DripID
		} else {
			rest = append(rest, o)
		}
	}

	// 5 台が同時に同じカップを別のドリッパーへ：同じ before で送るので、通るのは 1 台だけ（ほかは 409）
	target := rest[0].OrderCups[0].ID
	codes = make([]int, 5)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i], _ = f.put(t, write([]uuid.UUID{target}, unassigned, placed(3+i%3, 1, uuid.New(), nil)))
		}()
	}
	wg.Wait()
	ok = 0
	for _, code := range codes {
		switch code {
		case http.StatusNoContent:
			ok++
		case http.StatusConflict:
		default:
			t.Fatalf("PUT = %d", code)
		}
	}
	if ok != 1 {
		t.Fatalf("%d writes of the same cup succeeded, want 1", ok)
	}

	// 残りを待機に入れ、5 台が同時に同じカードの「次へ」：通るのは 1 回だけ
	for i, o := range rest[1:] {
		f.mustPut(t, write(ids(o.OrderCups[0]), unassigned, placed(2, float64(10+i), uuid.New(), nil)))
	}
	codes = make([]int, 5)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i], _ = f.next(t, 2, &brewingID)
		}()
	}
	wg.Wait()
	ok = 0
	for _, code := range codes {
		switch code {
		case http.StatusOK:
			ok++
		case http.StatusConflict:
		default:
			t.Fatalf("next = %d", code)
		}
	}
	if ok != 1 {
		t.Fatalf("%d nexts succeeded, want 1", ok)
	}
	if n, err := countBrewing(db, 2, start.Add(-time.Hour), start.Add(time.Hour)); err != nil || n != 1 {
		t.Fatalf("brewing on dripper 2 = %d, %v; want 1", n, err)
	}

	// 注文の編集と CaOS の割当・戻すが重なっても、どちらの変更も消えない
	o := f.createOrder(t, 7, line(f.blend), line(f.blend))
	edit := models.OrderUpdateRequest{OrderId: 7, BillingAmount: 1000, Received: 1000, MenuIds: []models.MenuInfoCreate{
		{MenuId: f.menu.ID, OrderMenuId: &o.OrderMenus[0].ID}, {MenuId: f.menu.ID, OrderMenuId: &o.OrderMenus[1].ID},
	}}
	body, _ := json.Marshal(edit)
	card := uuid.New()
	wg.Add(2)
	go func() {
		defer wg.Done()
		for range 15 {
			if w := callWithParams(t, f.orders.UpdateOrder, http.MethodPut, string(body), gin.Params{{Key: "id", Value: o.ID.String()}}); w.Code != http.StatusOK {
				t.Errorf("PUT order = %d", w.Code)
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := range 15 {
			after := unassigned
			if i%2 == 0 {
				after = placed(4, 7, card, nil)
			}
			if code, body := f.put(t, write(ids(o.OrderCups...), f.state(t, o.OrderCups[0].ID), after)); code != http.StatusNoContent {
				t.Errorf("PUT caos %d = %d: %s", i, code, body)
			}
		}
	}()
	wg.Wait()
	// 最後は割当（i = 14）
	for _, c := range o.OrderCups {
		if cup := f.cup(t, c.ID); cup.DripID == nil || *cup.DripID != card || cup.Dripper == nil || *cup.Dripper != 4 {
			t.Fatalf("cup %+v lost the last write", cup)
		}
	}
}

func TestCaosWriteReachesOtherInstances(t *testing.T) {
	db, dsn := openListenTestDB(t)
	f := newCaosFixture(t, db)
	// 同じプロセスの中ではインスタンスの ID が同じなので、送った通知は別の接続で受けて確かめる
	other := listenAsOtherInstance(t, dsn, ordersChangedChannel)
	o := f.createOrder(t, 1, line(f.blend))
	hub := NewHub()
	f.caos.hub = hub

	// 書いた注文をこのインスタンスの画面へ配り（カップに CaOS の列が載る）、ほかのインスタンスへ orders_changed で知らせる
	card := uuid.New()
	f.mustPut(t, write(ids(o.OrderCups[0]), unassigned, placed(3, 1, card, nil)))
	msg := nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeOrder || msg.Order == nil || msg.Order.Cups[0].DripId == nil || uuid.UUID(*msg.Order.Cups[0].DripId) != card {
		t.Fatalf("broadcast = %+v", msg)
	}
	expectOrderNotification(t, other, o.ID)

	// 「次へ」も同じ
	if code, _ := f.next(t, 3, nil); code != http.StatusOK {
		t.Fatalf("next = %d", code)
	}
	msg = nextBroadcast(t, hub)
	if msg.Order == nil || msg.Order.Cups[0].BrewStartedAt == nil {
		t.Fatalf("broadcast = %+v", msg)
	}
	expectOrderNotification(t, other, o.ID)
}

// このインスタンスから注文の変更の通知（"<インスタンスの ID> <注文の ID>"）が届くことを確かめる
func expectOrderNotification(t *testing.T, conn *pgx.Conn, orderID uuid.UUID) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			t.Fatalf("no notification of order %s: %v", orderID, err)
		}
		if n.Channel == ordersChangedChannel && n.Payload == instanceID+" "+orderID.String() {
			return
		}
	}
}
