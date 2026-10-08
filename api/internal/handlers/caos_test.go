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
	"gorm.io/gorm"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// CaOS の盤面の DB のテスト。注文の DB と同じく LISTEN_TEST_DATABASE_URL を渡したときだけ走る（openListenTestDB）。

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
	hot := models.ItemType{Name: "hot", DisplayName: "ホット"}
	milk := models.ItemType{Name: "milk", DisplayName: "ミルク"}
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

// createOrder は注文番号 no の注文を作る。lines は明細ごとのカップの商品。
func (f *caosFixture) createOrder(t *testing.T, no int, lines ...[]models.Item) models.Order {
	t.Helper()
	order := models.Order{ID: uuid.New(), OrderId: no, CreatedAt: time.Now(), BillingAmount: 500, Received: 500}
	pos := 0
	for _, items := range lines {
		line := models.OrderMenu{ID: uuid.New(), OrderID: order.ID, MenuID: f.menu.ID, MenuName: f.menu.Name, UnitPrice: 500}
		order.OrderMenus = append(order.OrderMenus, line)
		for _, item := range items {
			order.OrderCups = append(order.OrderCups, models.OrderCup{ID: uuid.New(), OrderMenuID: line.ID, ItemID: item.ID, Position: pos})
			pos++
		}
	}
	if err := f.db.Omit("OrderCups.Item", "OrderMenus.Menu").Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	return order
}

func (f *caosFixture) board(t *testing.T) []caos.Card {
	t.Helper()
	msg, err := f.caos.BoardMessage()
	if err != nil {
		t.Fatal(err)
	}
	return msg.Drips
}

func (f *caosFixture) cup(t *testing.T, id uuid.UUID) models.OrderCup {
	t.Helper()
	var cup models.OrderCup
	if err := f.db.First(&cup, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return cup
}

// op は POST /api/caos/ops を呼び、状態コードと op_id を返す。
func (f *caosFixture) op(t *testing.T, op map[string]any) (int, *uuid.UUID) {
	t.Helper()
	body, _ := json.Marshal(op)
	w := callHandler(t, f.caos.ApplyCaosOp, http.MethodPost, string(body))
	var res struct {
		OpID *uuid.UUID `json:"op_id"`
	}
	if w.Code == http.StatusOK {
		if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
			t.Fatal(err)
		}
	}
	return w.Code, res.OpID
}

func (f *caosFixture) mustOp(t *testing.T, op map[string]any) *uuid.UUID {
	t.Helper()
	code, id := f.op(t, op)
	if code != http.StatusOK {
		t.Fatalf("op %v = %d", op, code)
	}
	return id
}

func ref(c caos.Card) map[string]any {
	ids := make([]string, len(c.Cups))
	for i, cup := range c.Cups {
		ids[i] = cup.ID.String()
	}
	out := map[string]any{"cup_ids": ids}
	if c.ID != nil {
		out["id"] = c.ID.String()
	}
	return out
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

func filterCards(cards []caos.Card, status caos.Status) []caos.Card {
	var out []caos.Card
	for _, c := range cards {
		if c.Status == status {
			out = append(out, c)
		}
	}
	return out
}

func TestCaosOpsOnDB(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, []models.Item{f.blend, f.blend}, []models.Item{f.milk})
	o2 := f.createOrder(t, 2, []models.Item{f.blend})

	// 未割当は保存せず、カップから組み立てる（ミルクは出さない）
	cards := f.board(t)
	if len(cards) != 2 || cards[0].ID != nil || len(cards[0].Cups) != 2 || len(cards[1].Cups) != 1 {
		t.Fatalf("board = %+v, want 2 unassigned cards", cards)
	}

	// 割当：カードの行を作り、カップに ID を入れる。空いている列なのでそのまま抽出を始める
	if id := f.mustOp(t, map[string]any{"name": "assign", "card": ref(cards[0]), "lane": 1}); id == nil {
		t.Fatal("no op_id")
	}
	var row models.CaosDrip
	if err := db.First(&row).Error; err != nil || row.Status != caos.StatusBrewing || row.Lane != 1 {
		t.Fatalf("caos_drips = %+v, %v", row, err)
	}
	if cup := f.cup(t, o1.OrderCups[0].ID); cup.DripID == nil || *cup.DripID != row.ID {
		t.Fatalf("cup = %+v, want drip_id %s", cup, row.ID)
	}

	// 注文を編集しても、残ったカップは同じ drip_id のまま
	edit := models.OrderUpdateRequest{OrderId: 1, BillingAmount: 600, Received: 600, MenuIds: []models.MenuInfoCreate{
		{MenuId: f.menu.ID, OrderMenuId: &o1.OrderMenus[0].ID}, {MenuId: f.menu.ID, OrderMenuId: &o1.OrderMenus[1].ID},
	}}
	body, _ := json.Marshal(edit)
	if w := callWithParams(t, f.orders.UpdateOrder, http.MethodPut, string(body), gin.Params{{Key: "id", Value: o1.ID.String()}}); w.Code != http.StatusOK {
		t.Fatalf("PUT order = %d: %s", w.Code, w.Body)
	}
	if cup := f.cup(t, o1.OrderCups[1].ID); cup.DripID == nil || *cup.DripID != row.ID {
		t.Fatalf("cup after edit = %+v, want drip_id %s", cup, row.ID)
	}

	f.mustOp(t, map[string]any{"name": "assign", "card": ref(cards[1]), "lane": 1})

	// 次へ：そのカードのカップだけ準備完了にする。ミルクが残るので注文はまだ準備完了でない
	next := f.mustOp(t, map[string]any{"name": "next", "lane": 1, "card": map[string]any{"id": row.ID.String()}})
	if cup := f.cup(t, o1.OrderCups[0].ID); cup.ReadyAt == nil {
		t.Fatal("cup is not ready after next")
	}
	if cup := f.cup(t, o1.OrderCups[2].ID); cup.ReadyAt != nil {
		t.Fatal("milk got ready")
	}
	var order models.Order
	if err := db.First(&order, "id = ?", o1.ID).Error; err != nil || order.ReadyAt != nil {
		t.Fatalf("order = %+v, want not ready", order)
	}
	// 同じカードの「次へ」をもう一度押しても、次のカードは終わらせない
	if code, _ := f.op(t, map[string]any{"name": "next", "lane": 1, "card": map[string]any{"id": row.ID.String()}}); code != http.StatusUnprocessableEntity {
		t.Fatalf("second next = %d, want 422", code)
	}
	if brewing := filterCards(f.board(t), caos.StatusBrewing); len(brewing) != 1 || brewing[0].Cups[0].ID != o2.OrderCups[0].ID {
		t.Fatalf("brewing = %+v, want order 2", brewing)
	}

	// 1つ戻す：カードと準備完了が元に戻る。同じ操作は 2 回戻せない
	if id := f.mustOp(t, map[string]any{"name": "undo", "op_id": next.String()}); id != nil {
		t.Fatalf("undo returned op_id %s", id)
	}
	if cup := f.cup(t, o1.OrderCups[0].ID); cup.ReadyAt != nil {
		t.Fatal("cup is still ready after undo")
	}
	if code, _ := f.op(t, map[string]any{"name": "undo", "op_id": next.String()}); code != http.StatusUnprocessableEntity {
		t.Fatalf("second undo = %d, want 422", code)
	}

	// マスターでカップを準備完了にしたら、そのカードは終わり扱い。注文はミルクも準備完了で準備完了になる
	for _, cup := range o1.OrderCups {
		w := callWithParams(t, f.orders.MarkOrderCupReady, http.MethodPatch, "", gin.Params{{Key: "id", Value: o1.ID.String()}, {Key: "cupId", Value: cup.ID.String()}})
		if w.Code != http.StatusOK {
			t.Fatalf("PATCH cup ready = %d", w.Code)
		}
	}
	cards = f.board(t)
	if done := filterCards(cards, caos.StatusDone); len(done) != 1 || *done[0].ID != row.ID || done[0].FinishedAt == nil {
		t.Fatalf("done = %+v, want the card finished at the master", done)
	}
	// 抽出中が無くなった列の「次へ」は、待機の先頭を始める
	f.mustOp(t, map[string]any{"name": "next", "lane": 1})
	brewing := filterCards(f.board(t), caos.StatusBrewing)
	if len(brewing) != 1 || brewing[0].Cups[0].ID != o2.OrderCups[0].ID {
		t.Fatalf("brewing = %+v, want order 2", brewing)
	}

	// 注文を消すと、カップが無くなったカードは盤面から除く（読むときに判断する）
	if w := callWithParams(t, f.orders.DeleteOrder, http.MethodDelete, "", gin.Params{{Key: "id", Value: o2.ID.String()}}); w.Code != http.StatusOK {
		t.Fatalf("DELETE order = %d", w.Code)
	}
	if brewing := filterCards(f.board(t), caos.StatusBrewing); len(brewing) != 0 {
		t.Fatalf("brewing = %+v, want none", brewing)
	}

	// ルールに合わない操作は 422、形の違うリクエストは 400
	if code, _ := f.op(t, map[string]any{"name": "assign", "card": map[string]any{"id": uuid.NewString()}, "lane": 1}); code != http.StatusUnprocessableEntity {
		t.Fatalf("assign a missing card = %d", code)
	}
	if code, _ := f.op(t, map[string]any{"name": "undo"}); code != http.StatusBadRequest {
		t.Fatalf("undo without op_id = %d", code)
	}

	// 1 つの列で抽出中は 1 枚だけ（DB でも止める）
	day := caos.Day(time.Now())
	for i := range 2 {
		err := db.Create(&models.CaosDrip{ID: uuid.New(), Day: day, Lane: 5, Status: caos.StatusBrewing, CreatedAt: time.Now()}).Error
		if i == 1 && err == nil {
			t.Fatal("two brewing cards on one lane were saved")
		}
	}
}

func TestCaosConcurrentOps(t *testing.T) {
	db, _ := openListenTestDB(t)
	f := newCaosFixture(t, db)
	for no := 1; no <= 6; no++ {
		f.createOrder(t, no, []models.Item{f.blend})
	}

	// 6 台が同時に別のカードを同じ列へ：全部通り、抽出中は 1 枚だけ
	cards := f.board(t)
	var wg sync.WaitGroup
	codes := make([]int, len(cards))
	for i, c := range cards {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i], _ = f.op(t, map[string]any{"name": "assign", "card": ref(c), "lane": 2})
		}()
	}
	wg.Wait()
	for i, code := range codes {
		if code != http.StatusOK {
			t.Fatalf("assign %d = %d", i, code)
		}
	}
	cards = f.board(t)
	brewing, queued := filterCards(cards, caos.StatusBrewing), filterCards(cards, caos.StatusQueued)
	if len(brewing) != 1 || len(queued) != 5 {
		t.Fatalf("brewing %d, queued %d; want 1 and 5", len(brewing), len(queued))
	}

	// 5 台が同時に同じカードの「次へ」：通るのは 1 回だけ
	codes = make([]int, 5)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i], _ = f.op(t, map[string]any{"name": "next", "lane": 2, "card": map[string]any{"id": brewing[0].ID.String()}})
		}()
	}
	wg.Wait()
	ok := 0
	for _, code := range codes {
		switch code {
		case http.StatusOK:
			ok++
		case http.StatusUnprocessableEntity:
		default:
			t.Fatalf("next = %d", code)
		}
	}
	if ok != 1 || len(filterCards(f.board(t), caos.StatusDone)) != 1 {
		t.Fatalf("%d nexts succeeded, want 1", ok)
	}

	// 注文の編集と CaOS の割当・戻すが重なっても、カップの drip_id は消えも残りもしない
	o := f.createOrder(t, 7, []models.Item{f.blend}, []models.Item{f.blend})
	edit := models.OrderUpdateRequest{OrderId: 7, BillingAmount: 1000, Received: 1000, MenuIds: []models.MenuInfoCreate{
		{MenuId: f.menu.ID, OrderMenuId: &o.OrderMenus[0].ID}, {MenuId: f.menu.ID, OrderMenuId: &o.OrderMenus[1].ID},
	}}
	body, _ := json.Marshal(edit)
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
			var card *caos.Card
			for _, c := range f.board(t) {
				if c.Cups[0].ID == o.OrderCups[0].ID {
					card = &c
				}
			}
			name := map[bool]string{true: "assign", false: "unassign"}[i%2 == 0]
			// 列 2 は抽出中があるので、待機に入る
			if code, _ := f.op(t, map[string]any{"name": name, "card": ref(*card), "lane": 2}); code != http.StatusOK {
				t.Errorf("%s = %d", name, code)
			}
		}
	}()
	wg.Wait()
	// 最後は割当（i = 14）：注文 7 の 2 杯のカップが、保存した待機のカードを指している
	var cups []models.OrderCup
	if err := db.Where("order_id = ?", o.ID).Find(&cups).Error; err != nil {
		t.Fatal(err)
	}
	for _, cup := range cups {
		var row models.CaosDrip
		if cup.DripID == nil || db.First(&row, "id = ?", *cup.DripID).Error != nil || row.Status != caos.StatusQueued {
			t.Fatalf("cup %+v does not point to the queued card", cup)
		}
	}
	// 戻したカードの行は残っていない（列 2 は抽出中 1・待機 4＋注文 7）
	var count int64
	if err := db.Model(&models.CaosDrip{}).Where("status = 'queued'").Count(&count).Error; err != nil || count != 5 {
		t.Fatalf("queued rows = %d, %v; want 5", count, err)
	}
}

// 盤面の配信を待つ（ほかの配信は読み飛ばす）。
func waitDrips(t *testing.T, hub *Hub, what string, ok func([]caos.Card) bool) {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case msg := <-hub.broadcast:
			if msg.Type == WSMessageTypeDrips && ok(msg.Drips) {
				return
			}
		case <-deadline:
			t.Fatalf("no drips broadcast: %s", what)
		}
	}
}

func TestCaosBoardReachesOtherInstances(t *testing.T) {
	db, dsn := openListenTestDB(t)
	a := newCaosFixture(t, db) // 操作するインスタンス
	// 同じプロセスの中ではインスタンスの ID が同じなので、A が送る通知は別の接続で受けて確かめ、
	// B へはほかのインスタンスのふりをして通知を送る
	other := listenAsOtherInstance(t, dsn, caosBoardChangedChannel)

	// ほかのインスタンス：盤面の配り直しを動かし、DB の通知を待ち受ける
	hubB := NewHub()
	caosB := NewCaosHandler(db, hubB)
	go hubB.RunBoard(caosB.BoardMessage)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go NewOrderHandler(db, hubB, nil).ListenChanges(ctx, dsn)
	// 待ち受けを始めたら盤面も配り直す
	waitDrips(t, hubB, "on listening", func([]caos.Card) bool { return true })

	// A で注文が入ると、B は注文の通知を受けて盤面も配り直す
	o := a.createOrder(t, 1, []models.Item{a.blend})
	notifyFromOtherInstance(t, db, o.ID.String())
	waitDrips(t, hubB, "after the order", func(cards []caos.Card) bool {
		return len(cards) == 1 && cards[0].Status == caos.StatusUnassigned
	})

	// A で割り当てると、B は盤面の通知を受けて配り直す
	a.mustOp(t, map[string]any{"name": "assign", "card": ref(a.board(t)[0]), "lane": 4})
	expectNotification(t, other, caosBoardChangedChannel)
	notifyStateFromOtherInstance(t, db, caosBoardChangedChannel)
	waitDrips(t, hubB, "after assign", func(cards []caos.Card) bool {
		return len(cards) == 1 && cards[0].Status == caos.StatusBrewing && *cards[0].Lane == 4
	})

	// 自分が送った盤面の通知では配り直さない
	notifyChanged(db, caosBoardChangedChannel, instanceID)
	select {
	case msg := <-hubB.broadcast:
		t.Fatalf("unexpected broadcast: %s", msg.Type)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestPendingChangesBoard(t *testing.T) {
	q := newPendingChanges()
	other := uuid.NewString()
	// 盤面の通知と、注文の通知で盤面を配り直す。自分が送ったものは積まない
	q.add(caosBoardChangedChannel, instanceID)
	if s := q.take(); s.board {
		t.Fatal("own board notification queued")
	}
	q.add(caosBoardChangedChannel, other)
	if s := q.take(); !s.board || s.allOrders || len(s.orderIDs) != 0 {
		t.Fatalf("take() = %+v, want board only", s)
	}
	q.add(ordersChangedChannel, fmt.Sprintf("%s %s", other, uuid.NewString()))
	if s := q.take(); !s.board || len(s.orderIDs) != 1 {
		t.Fatalf("take() = %+v, want the order and the board", s)
	}
}
