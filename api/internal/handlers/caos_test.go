package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

// 注文の API と CaOS の盤面の API を、本物の Postgres を使って HTTP で通す。
// CAOS_TEST_DATABASE_URL を渡したときだけ動く（空の DB を渡すこと。表を作り直す）。

type caosEnv struct {
	db     *gorm.DB
	router *gin.Engine
	menu   uuid.UUID
}

func newCaosEnv(t *testing.T) *caosEnv {
	t.Helper()
	dsn := os.Getenv("CAOS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("CAOS_TEST_DATABASE_URL がないので、DB を使うテストは飛ばす")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	mustDo(t, db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error)
	mustDo(t, db.AutoMigrate(&models.ItemType{}, &models.Item{}, &models.Menu{}, &models.MenuItem{}, &models.Order{}, &models.Comment{},
		&models.OrderMenu{}, &models.StockResource{}, &models.ItemStockUsage{}, &models.StockEvent{}))
	sql, err := os.ReadFile("../../sql/2026-10_caos.sql")
	mustDo(t, err)
	mustDo(t, db.Exec(string(sql)).Error)
	mustDo(t, db.Exec("TRUNCATE caos_drips, caos_boards, order_menus, comments, orders, menu_items, menus, items, item_types, stock_events, item_stock_usages, stock_resources").Error)

	hot := models.ItemType{Name: "hot", DisplayName: "ホット"}
	mustDo(t, db.Create(&hot).Error)
	item := models.Item{Name: "優勝ブレンド", Abbr: "優勝", ItemTypeID: hot.ID}
	mustDo(t, db.Create(&item).Error)
	menu := models.Menu{Name: "優勝ブレンド", Abbr: "優勝", Price: 500, Key: "champ"}
	mustDo(t, db.Create(&menu).Error)
	mustDo(t, db.Create(&models.MenuItem{MenuID: menu.ID, ItemID: item.ID, Quantity: 1}).Error)

	gin.SetMode(gin.TestMode)
	hub := NewHub()
	go hub.Run()
	store := caos.NewStore(db)
	orders := NewOrderHandler(db, hub, NewInventory(db, notify.NewSlack(""), RemindAuth{}, ""), store)
	c := NewCaosHandler(store, hub, orders)
	r := gin.New()
	r.POST("/api/orders", orders.CreateOrder)
	r.GET("/api/orders/:id", orders.GetOrder)
	r.PATCH("/api/orders/:id/ready", orders.MarkOrderReady)
	r.DELETE("/api/orders/:id", orders.DeleteOrder)
	r.GET("/api/caos/boards/:day", c.GetBoard)
	r.POST("/api/caos/boards/:day/ops", c.ApplyOp)
	return &caosEnv{db: db, router: r, menu: menu.ID}
}

func mustDo(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func (e *caosEnv) call(t *testing.T, method, path string, body any, out any) int {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		mustDo(t, json.NewEncoder(&buf).Encode(body))
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	if out != nil && w.Code < 300 {
		mustDo(t, json.Unmarshal(w.Body.Bytes(), out))
	}
	return w.Code
}

func (e *caosEnv) createOrder(t *testing.T, no, cups int) models.OrderResponse {
	t.Helper()
	menus := make([]map[string]any, cups)
	for i := range menus {
		menus[i] = map[string]any{"menu_id": e.menu}
	}
	var o models.OrderResponse
	if code := e.call(t, http.MethodPost, "/api/orders", map[string]any{"order_id": no, "billing_amount": 500, "received": 500, "menu_ids": menus}, &o); code != http.StatusCreated {
		t.Fatalf("注文を作れない：%d", code)
	}
	return o
}

func TestCaosThroughHTTP(t *testing.T) {
	e := newCaosEnv(t)
	day := caos.Day(time.Now())
	o := e.createOrder(t, 1, 1)

	var board caos.Snapshot
	if code := e.call(t, http.MethodGet, "/api/caos/boards/"+day, nil, &board); code != http.StatusOK || len(board.Drips) != 1 {
		t.Fatalf("注文を作るとカードができている：%d %+v", code, board)
	}
	card := board.Drips[0]

	var res caos.Result
	op := func(body map[string]any) int {
		return e.call(t, http.MethodPost, "/api/caos/boards/"+day+"/ops", body, &res)
	}
	if code := op(map[string]any{"name": "assign", "drip_id": card.ID, "dripper": 1}); code != http.StatusOK || res.Changed[0].Status != caos.StatusBrewing {
		t.Fatalf("割当：%d %+v", code, res)
	}
	if code := op(map[string]any{"name": "next", "dripper": 1}); code != http.StatusOK || len(res.Readied) != 1 {
		t.Fatalf("次へで準備完了：%d %+v", code, res)
	}
	var after models.OrderResponse
	e.call(t, http.MethodGet, "/api/orders/"+o.Id.String(), nil, &after)
	if after.ReadyAt == nil {
		t.Fatal("POS の注文に ready_at が付く")
	}
	if code := op(map[string]any{"name": "next", "dripper": 1}); code != http.StatusUnprocessableEntity {
		t.Fatalf("ルールに合わない操作は 422：%d", code)
	}
	if code := e.call(t, http.MethodGet, "/api/caos/boards/2026-13-01", nil, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("日付の形が違えば 422：%d", code)
	}

	// POS で準備完了にすると、抽出中のカードが終わる
	o2 := e.createOrder(t, 2, 1)
	e.call(t, http.MethodGet, "/api/caos/boards/"+day, nil, &board)
	for _, d := range board.Drips {
		if d.Status == caos.StatusUnassigned {
			op(map[string]any{"name": "assign", "drip_id": d.ID, "dripper": 2})
		}
	}
	e.call(t, http.MethodPatch, "/api/orders/"+o2.Id.String()+"/ready", nil, nil)
	e.call(t, http.MethodGet, "/api/caos/boards/"+day, nil, &board)
	for _, d := range board.Drips {
		if d.Status != caos.StatusDone {
			t.Fatalf("POS の準備完了でカードが終わる：%+v", d)
		}
	}

	// 注文を消すと、未割当のカードも消える
	o3 := e.createOrder(t, 3, 2)
	e.call(t, http.MethodDelete, "/api/orders/"+o3.Id.String(), nil, nil)
	e.call(t, http.MethodGet, "/api/caos/boards/"+day, nil, &board)
	if len(board.Drips) != 2 {
		t.Fatalf("消した注文のカードが残っている：%+v", board.Drips)
	}
}

func TestCaosFailureDoesNotBlockOrders(t *testing.T) {
	e := newCaosEnv(t)
	// CaOS の表が壊れていても（ここでは消してしまう）、POS の注文は通る
	mustDo(t, e.db.Exec("DROP TABLE caos_drips").Error)
	o := e.createOrder(t, 1, 1)
	var got models.OrderResponse
	if code := e.call(t, http.MethodGet, "/api/orders/"+o.Id.String(), nil, &got); code != http.StatusOK || len(got.Menus) != 1 {
		t.Fatalf("注文が保存されていない：%d", code)
	}
	if code := e.call(t, http.MethodPatch, "/api/orders/"+o.Id.String()+"/ready", nil, &got); code != http.StatusOK || got.ReadyAt == nil {
		t.Fatalf("準備完了も通る：%d", code)
	}
}
