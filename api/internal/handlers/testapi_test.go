package handlers

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
	"cafeore-pos/api/internal/testdb"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// -------------------------------------------------------------------
// API を丸ごと立てる

// testAPI は main.go と同じルーティングの API と、配信・Slack の受け口。
type testAPI struct {
	t      *testing.T
	db     *gorm.DB
	router *gin.Engine
	slack  *fakeSlack
	inv    *Inventory
	// 配信を受け取る端末。WebSocket を張らず、Hub が積んだものをそのまま読む
	ws *Client
}

func newTestAPI(t *testing.T) *testAPI {
	t.Helper()
	// TEST_DATABASE_URL の Postgres に使い捨ての schema を作り、モデルからテーブルを作る
	// （無ければスキップ、CI では落とす）。決まりは testdb にまとめてある
	db := testdb.New(t)

	hub := NewHub()
	go hub.Run()
	ws := &Client{hub: hub, send: make(chan []byte, 256)}
	hub.add(ws)

	slack := newFakeSlack(t)
	inv := NewInventory(db, notify.NewSlack(slack.url), RemindAuth{}, "")

	gin.SetMode(gin.TestMode)
	r := gin.New()
	registerTestRoutes(r, db, hub, inv)

	api := &testAPI{t: t, db: db, router: r, slack: slack, inv: inv, ws: ws}
	// 注文の作成などは、応答のあとに goroutine で在庫の通知を判定する。
	// schema を消す前に終わらせておかないと、消えたテーブルを読んでログが汚れる
	t.Cleanup(api.waitBackground)
	return api
}

// cmd/server/main.go と同じルーティング
func registerTestRoutes(r *gin.Engine, db *gorm.DB, hub *Hub, inv *Inventory) {
	itemHandler := NewItemHandler(db)
	menuHandler := NewMenuHandler(db)
	itemTypeHandler := NewItemTypeHandler(db)
	inventoryHandler := NewInventoryHandler(inv)
	orderHandler := NewOrderHandler(db, hub, inv)
	commentHandler := NewCommentHandler(db, hub)
	masterStateHandler := NewMasterStateHandler(db, hub)
	cashierStateHandler := NewCashierStateHandler(db, hub)
	colorSettingHandler := NewColorSettingHandler(db)

	api := r.Group("/api")
	api.GET("/items", itemHandler.GetItems)
	api.POST("/items", itemHandler.CreateItem)
	api.GET("/items/:id", itemHandler.GetItem)
	api.PUT("/items/:id", itemHandler.UpdateItem)
	api.DELETE("/items/:id", itemHandler.DeleteItem)

	api.GET("/menus", menuHandler.GetMenus)
	api.POST("/menus", menuHandler.CreateMenu)
	api.GET("/menus/:id", menuHandler.GetMenu)
	api.PUT("/menus/:id", menuHandler.UpdateMenu)
	api.DELETE("/menus/:id", menuHandler.DeleteMenu)

	api.GET("/item-types", itemTypeHandler.GetItemTypes)
	api.POST("/item-types", itemTypeHandler.CreateItemType)
	api.GET("/item-types/:id", itemTypeHandler.GetItemType)
	api.PUT("/item-types/:id", itemTypeHandler.UpdateItemType)
	api.DELETE("/item-types/:id", itemTypeHandler.DeleteItemType)

	api.GET("/orders", orderHandler.GetOrders)
	api.GET("/ws/orders", orderHandler.WSHandler)
	api.POST("/orders", orderHandler.CreateOrder)
	api.GET("/orders/:id", orderHandler.GetOrder)
	api.PUT("/orders/:id", orderHandler.UpdateOrder)
	api.DELETE("/orders/:id", orderHandler.DeleteOrder)
	api.PATCH("/orders/:id/ready", orderHandler.MarkOrderReady)
	api.PATCH("/orders/:id/served", orderHandler.MarkOrderServed)
	api.PATCH("/orders/:id/cups/:cupId/ready", orderHandler.MarkOrderCupReady)
	api.PATCH("/orders/:id/cups/:cupId/served", orderHandler.MarkOrderCupServed)

	api.GET("/orders/:id/comments", commentHandler.GetOrderComments)
	api.POST("/orders/:id/comments", commentHandler.CreateComment)

	api.GET("/master-status", masterStateHandler.GetMasterStatus)
	api.POST("/master-status", masterStateHandler.UpdateMasterStatus)

	api.GET("/cashier-state", cashierStateHandler.GetCashierState)
	api.PUT("/cashier-state", cashierStateHandler.UpdateCashierState)

	api.GET("/inventory", inventoryHandler.GetInventory)
	api.POST("/inventory/resources", inventoryHandler.CreateStockResource)
	api.PUT("/inventory/resources/:id", inventoryHandler.UpdateStockResource)
	api.DELETE("/inventory/resources/:id", inventoryHandler.DeleteStockResource)
	api.POST("/inventory/resources/:id/events", inventoryHandler.CreateStockEvent)
	api.GET("/inventory/usages", inventoryHandler.GetStockUsages)
	api.PUT("/inventory/usages", inventoryHandler.ReplaceStockUsages)
	api.POST("/inventory/remind", inventoryHandler.RemindInventory)
	api.GET("/color-settings", colorSettingHandler.GetColorSettings)
	api.PUT("/color-settings", colorSettingHandler.UpsertColorSetting)
	api.DELETE("/color-settings/:id", colorSettingHandler.DeleteColorSetting)
}

type testResponse struct {
	t    *testing.T
	Code int
	Body []byte
}

// JSON を decode する。v の型と合わなければテストを落とす
func (r testResponse) decode(v any) {
	r.t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		r.t.Fatalf("failed to decode response %s: %v", r.Body, err)
	}
}

// 期待するステータスでなければ、本文ごと出して落とす
func (r testResponse) expect(code int) testResponse {
	r.t.Helper()
	if r.Code != code {
		r.t.Fatalf("status = %d, want %d: %s", r.Code, code, r.Body)
	}
	return r
}

// body が string ならそのまま、それ以外は JSON にして送る
func (a *testAPI) do(method, path string, body any, headers ...string) testResponse {
	a.t.Helper()
	var reader io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		reader = strings.NewReader(b)
	default:
		data, err := json.Marshal(b)
		if err != nil {
			a.t.Fatal(err)
		}
		reader = bytes.NewReader(data)
	}
	req := httptest.NewRequest(method, path, reader)
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	rec := httptest.NewRecorder()
	a.router.ServeHTTP(rec, req)
	return testResponse{t: a.t, Code: rec.Code, Body: rec.Body.Bytes()}
}

// 次に配信されたメッセージ
func (a *testAPI) nextBroadcast() WSMessage {
	a.t.Helper()
	select {
	case data := <-a.ws.send:
		var msg WSMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			a.t.Fatal(err)
		}
		return msg
	case <-time.After(2 * time.Second):
		a.t.Fatal("no broadcast")
		return WSMessage{}
	}
}

// 配信が無いこと。Hub は別の goroutine で配るので、少し待ってから確かめる
func (a *testAPI) noBroadcast() {
	a.t.Helper()
	select {
	case data := <-a.ws.send:
		a.t.Fatalf("unexpected broadcast: %s", data)
	case <-time.After(100 * time.Millisecond):
	}
}

// 応答のあとに走る在庫の通知の判定（go CheckAlerts）が終わるのを待つ。
// 判定が終わったかは外から見えないので、使用中の接続が続けて 0 になるまで待つ
func (a *testAPI) waitBackground() {
	sqlDB, err := a.db.DB()
	if err != nil {
		return
	}
	idle := 0
	for deadline := time.Now().Add(5 * time.Second); idle < 3 && time.Now().Before(deadline); {
		time.Sleep(20 * time.Millisecond)
		if sqlDB.Stats().InUse == 0 {
			idle++
		} else {
			idle = 0
		}
	}
}

// 作ったものを直接 DB に入れる
func (a *testAPI) create(values ...any) {
	a.t.Helper()
	for _, v := range values {
		if err := a.db.Create(v).Error; err != nil {
			a.t.Fatal(err)
		}
	}
}

// -------------------------------------------------------------------
// Slack の Incoming Webhook の代わり

type fakeSlack struct {
	url string

	mu       sync.Mutex
	messages []string
	// 0 以外なら、そのステータスで失敗を返す（送信は記録しない）
	failWith int
	received chan string
}

func newFakeSlack(t *testing.T) *fakeSlack {
	t.Helper()
	s := &fakeSlack{received: make(chan string, 64)}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Text string `json:"text"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		s.mu.Lock()
		failWith := s.failWith
		if failWith == 0 {
			s.messages = append(s.messages, body.Text)
		}
		s.mu.Unlock()
		if failWith != 0 {
			w.WriteHeader(failWith)
			return
		}
		s.received <- body.Text
	}))
	t.Cleanup(srv.Close)
	s.url = srv.URL
	return s
}

func (s *fakeSlack) fail(status int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.failWith = status
}

func (s *fakeSlack) sent() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.messages...)
}

// -------------------------------------------------------------------
// よく使うマスタ

// ホット・アイス・グッズの種類、それぞれのアイテム、メニューをひととおり入れたもの
type testMaster struct {
	hotType, iceType, goodsType models.ItemType
	blend, iced, sticker        models.Item
	// ブレンド 1 杯（400 円）
	blendMenu models.Menu
	// ブレンド 2 杯とステッカー（ブレンドのセット、900 円）
	pairMenu models.Menu
	// アイスコーヒー 1 杯（450 円）
	iceMenu models.Menu
}

func (a *testAPI) seedMaster() testMaster {
	a.t.Helper()
	m := testMaster{
		hotType:   models.ItemType{ID: uuid.New(), Name: "hot", DisplayName: "ホット"},
		iceType:   models.ItemType{ID: uuid.New(), Name: "ice", DisplayName: "アイス"},
		goodsType: models.ItemType{ID: uuid.New(), Name: goodsItemTypeName, DisplayName: "グッズ"},
	}
	m.blend = models.Item{ID: uuid.New(), Name: "ブレンド", Abbr: "ブ", ItemTypeID: m.hotType.ID}
	m.iced = models.Item{ID: uuid.New(), Name: "アイスコーヒー", Abbr: "ア", ItemTypeID: m.iceType.ID}
	m.sticker = models.Item{ID: uuid.New(), Name: "ステッカー", Abbr: "ス", ItemTypeID: m.goodsType.ID}
	a.create(&m.hotType, &m.iceType, &m.goodsType, &m.blend, &m.iced, &m.sticker)

	m.blendMenu = a.seedMenu("ブレンド", "blend", 400, models.MenuItem{ItemID: m.blend.ID, Quantity: 1})
	m.pairMenu = a.seedMenu("ペアセット", "pair", 900,
		models.MenuItem{ItemID: m.blend.ID, Quantity: 2},
		models.MenuItem{ItemID: m.sticker.ID, Quantity: 1})
	m.iceMenu = a.seedMenu("アイスコーヒー", "ice", 450, models.MenuItem{ItemID: m.iced.ID, Quantity: 1})
	return m
}

// メニューと構成品を DB に入れる。アイテムは先に入れておくこと
func (a *testAPI) seedMenu(name, key string, price int, items ...models.MenuItem) models.Menu {
	a.t.Helper()
	menu := models.Menu{ID: uuid.New(), Name: name, Abbr: key, Key: key, Price: price}
	for i := range items {
		items[i].MenuID = menu.ID
	}
	a.create(&menu, &items)
	menu.MenuItems = items
	return menu
}

func menuLine(menu models.Menu) models.MenuInfoCreate {
	return models.MenuInfoCreate{MenuId: menu.ID}
}

// 注文を API で作る
func (a *testAPI) createOrder(orderID int, menus ...models.Menu) models.OrderResponse {
	a.t.Helper()
	lines := make([]models.MenuInfoCreate, len(menus))
	total := 0
	for i, menu := range menus {
		lines[i] = menuLine(menu)
		total += menu.Price
	}
	var resp models.OrderResponse
	a.do(http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId: orderID, BillingAmount: total, Received: total, MenuIds: lines,
	}).expect(http.StatusCreated).decode(&resp)
	// 作成の配信を読み捨てる
	if msg := a.nextBroadcast(); msg.Type != WSMessageTypeOrder || msg.Order.Id != resp.Id {
		a.t.Fatalf("unexpected broadcast after creating order: %+v", msg)
	}
	return resp
}

func (a *testAPI) loadOrder(id uuid.UUID) models.Order {
	a.t.Helper()
	var order models.Order
	if err := preloadOrder(a.db).First(&order, "id = ?", id).Error; err != nil {
		a.t.Fatal(err)
	}
	return order
}

func (a *testAPI) count(model any, query string, args ...any) int64 {
	a.t.Helper()
	var n int64
	q := a.db.Model(model)
	if query != "" {
		q = q.Where(query, args...)
	}
	if err := q.Count(&n).Error; err != nil {
		a.t.Fatal(err)
	}
	return n
}
