package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"

	"cafeore-pos/api/internal/models"
)

// グッズだけの注文（カップが1つもできない注文）を、作成・編集のときに提供済みにする（Issue #733）。
// POST / PUT /api/orders を本物の Postgres で通す。DB は在庫の消費のテスト（inventory_consumption_test.go）と
// 同じものを使う：TEST_DATABASE_URL を渡したときだけ動く。

func (e *inventoryEnv) orderAPI() *gin.Engine {
	e.t.Helper()
	gin.SetMode(gin.TestMode)
	hub := NewHub()
	go hub.Run()
	h := NewOrderHandler(e.db, hub, nil)
	r := gin.New()
	r.POST("/api/orders", h.CreateOrder)
	r.PUT("/api/orders/:id", h.UpdateOrder)
	return r
}

func (e *inventoryEnv) sendOrder(r *gin.Engine, method, path string, body any, wantStatus int) models.OrderResponse {
	e.t.Helper()
	data, err := json.Marshal(body)
	e.must(err)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(method, path, bytes.NewReader(data)))
	if w.Code != wantStatus {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, w.Code, wantStatus, w.Body.String())
	}
	var resp models.OrderResponse
	e.must(json.Unmarshal(w.Body.Bytes(), &resp))
	return resp
}

func menuLines(menus ...models.Menu) []models.MenuInfoCreate {
	lines := make([]models.MenuInfoCreate, len(menus))
	for i, menu := range menus {
		lines[i] = models.MenuInfoCreate{MenuId: menu.ID}
	}
	return lines
}

// 編集のリクエスト。既存の明細は ID を付けて引き継ぐ。
func updateRequest(resp models.OrderResponse, added ...models.Menu) models.OrderUpdateRequest {
	lines := make([]models.MenuInfoCreate, 0, len(resp.Menus)+len(added))
	for _, m := range resp.Menus {
		orderMenuID := m.Id
		lines = append(lines, models.MenuInfoCreate{MenuId: m.Menu.Id, OrderMenuId: &orderMenuID})
	}
	lines = append(lines, menuLines(added...)...)
	return models.OrderUpdateRequest{
		Id: resp.Id, OrderId: resp.OrderId, BillingAmount: resp.BillingAmount, Received: resp.Received,
		ReadyAt: resp.ReadyAt, ServedAt: resp.ServedAt, MenuIds: lines,
	}
}

func TestCreateOrderServesGoodsOnlyOrder(t *testing.T) {
	e := newInventoryEnv(t)
	r := e.orderAPI()
	hot, milk, goodsType := e.itemType("hot"), e.itemType("milk"), e.goodsType("物販")
	blend, iceMilk, bag := e.item("ブレンド", hot), e.item("アイスミルク", milk), e.item("ドリップバッグ", goodsType)
	goods := e.menu("goods", models.MenuItem{ItemID: bag.ID, Quantity: 2})
	coffee := e.menu("coffee", models.MenuItem{ItemID: blend.ID, Quantity: 1})
	set := e.menu("set", models.MenuItem{ItemID: bag.ID, Quantity: 1}, models.MenuItem{ItemID: iceMilk.ID, Quantity: 1})

	// グッズだけ（カップを作らない種類だけ）の注文は、作った時点で準備完了・提供済み
	resp := e.sendOrder(r, http.MethodPost, "/api/orders", models.OrderCreateRequest{OrderId: 1, BillingAmount: 500, Received: 500, MenuIds: menuLines(goods, goods)}, http.StatusCreated)
	if len(resp.Cups) != 0 {
		t.Fatalf("goods only order must not have cups: %+v", resp.Cups)
	}
	if !sameTime(resp.ReadyAt, &resp.CreatedAt) || !sameTime(resp.ServedAt, &resp.CreatedAt) {
		t.Fatalf("goods only order must be served at created_at: ready=%v served=%v created=%v", resp.ReadyAt, resp.ServedAt, resp.CreatedAt)
	}

	// 飲み物のある注文、グッズとカップを作る種類（抽出しないミルクも）のセットは準備中のまま
	for _, menus := range [][]models.Menu{{goods, coffee}, {set}} {
		resp := e.sendOrder(r, http.MethodPost, "/api/orders", models.OrderCreateRequest{OrderId: 2, BillingAmount: 500, Received: 500, MenuIds: menuLines(menus...)}, http.StatusCreated)
		if len(resp.Cups) != 1 || resp.ReadyAt != nil || resp.ServedAt != nil {
			t.Fatalf("order with a cup must be preparing: cups=%d ready=%v served=%v", len(resp.Cups), resp.ReadyAt, resp.ServedAt)
		}
	}
}

func TestUpdateOrderServesOrderThatBecomesGoodsOnly(t *testing.T) {
	e := newInventoryEnv(t)
	r := e.orderAPI()
	hot, goodsType := e.itemType("hot"), e.goodsType("物販")
	blend, bag := e.item("ブレンド", hot), e.item("ドリップバッグ", goodsType)
	goods := e.menu("goods", models.MenuItem{ItemID: bag.ID, Quantity: 1})
	coffee := e.menu("coffee", models.MenuItem{ItemID: blend.ID, Quantity: 1})

	// グッズだけの注文に飲み物を足すと、カップができて準備中に戻る
	resp := e.sendOrder(r, http.MethodPost, "/api/orders", models.OrderCreateRequest{OrderId: 1, BillingAmount: 500, Received: 500, MenuIds: menuLines(goods)}, http.StatusCreated)
	resp = e.sendOrder(r, http.MethodPut, "/api/orders/"+resp.Id.String(), updateRequest(resp, coffee), http.StatusOK)
	if len(resp.Cups) != 1 || resp.ReadyAt != nil || resp.ServedAt != nil {
		t.Fatalf("order with an added drink must be preparing: cups=%d ready=%v served=%v", len(resp.Cups), resp.ReadyAt, resp.ServedAt)
	}

	// 飲み物を外してグッズだけにすると、提供済みになる
	req := updateRequest(resp)
	for _, line := range req.MenuIds {
		if line.MenuId == goods.ID {
			req.MenuIds = []models.MenuInfoCreate{line}
		}
	}
	resp = e.sendOrder(r, http.MethodPut, "/api/orders/"+resp.Id.String(), req, http.StatusOK)
	if len(resp.Cups) != 0 || resp.ReadyAt == nil || resp.ServedAt == nil {
		t.Fatalf("order that becomes goods only must be served: cups=%d ready=%v served=%v", len(resp.Cups), resp.ReadyAt, resp.ServedAt)
	}

	// 提供済みのグッズだけの注文を編集しても、提供の時刻は変わらない
	servedAt := *resp.ServedAt
	resp = e.sendOrder(r, http.MethodPut, "/api/orders/"+resp.Id.String(), updateRequest(resp), http.StatusOK)
	if !sameTime(resp.ServedAt, &servedAt) {
		t.Fatalf("served goods only order must keep served_at: %v, want %v", resp.ServedAt, servedAt)
	}
}
