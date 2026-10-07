package handlers

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// レジの状態・オーダーストップ・WebSocket の初期データの結合テスト（Postgres を使う）

func cashierStateRequest(t *testing.T, submitted *uuid.UUID) models.CashierStateUpdateRequest {
	t.Helper()
	return models.CashierStateUpdateRequest{
		EdittingOrder:    parseEdittingOrder(t),
		SubmittedOrderId: (*openapi_types.UUID)(submitted),
	}
}

func TestCashierState(t *testing.T) {
	api := newTestAPI(t)

	// まだ一度も同期されていない
	api.do(http.MethodGet, "/api/cashier-state", nil).expect(http.StatusNotFound)

	submitted := uuid.New()
	var saved models.CashierStateResponse
	api.do(http.MethodPut, "/api/cashier-state", cashierStateRequest(t, &submitted)).expect(http.StatusOK).decode(&saved)
	if saved.SubmittedOrderId == nil || *saved.SubmittedOrderId != submitted || saved.EdittingOrder["orderId"] != 1.0 {
		t.Fatalf("saved: %+v", saved)
	}
	msg := api.nextBroadcast()
	if msg.Type != WSMessageTypeCashierState || msg.CashierState == nil || *msg.CashierState.SubmittedOrderId != submitted {
		t.Fatalf("broadcast: %+v", msg)
	}

	var got models.CashierStateResponse
	api.do(http.MethodGet, "/api/cashier-state", nil).expect(http.StatusOK).decode(&got)
	if !got.UpdatedAt.Equal(saved.UpdatedAt) || got.EdittingOrder["total"] != 400.0 || len(got.EdittingOrder["menus"].([]any)) != 1 {
		t.Fatalf("got: %+v", got)
	}

	// 次の注文に移ると、1 行を丸ごと置き換える
	next := cashierStateRequest(t, nil)
	next.EdittingOrder["orderId"] = 2.0
	next.EdittingOrder["menus"] = []any{}
	api.do(http.MethodPut, "/api/cashier-state", next).expect(http.StatusOK)
	api.nextBroadcast()

	api.do(http.MethodGet, "/api/cashier-state", nil).expect(http.StatusOK).decode(&got)
	if got.SubmittedOrderId != nil || got.EdittingOrder["orderId"] != 2.0 || len(got.EdittingOrder["menus"].([]any)) != 0 {
		t.Fatalf("replaced: %+v", got)
	}
	if n := api.count(&models.CashierState{}, ""); n != 1 {
		t.Fatalf("%d cashier states", n)
	}
}

func TestUpdateCashierStateRejectsBrokenState(t *testing.T) {
	api := newTestAPI(t)
	api.do(http.MethodPut, "/api/cashier-state", cashierStateRequest(t, nil)).expect(http.StatusOK)
	api.nextBroadcast()

	broken := cashierStateRequest(t, nil)
	delete(broken.EdittingOrder, "orderId")
	cases := map[string]any{
		"broken json":             `{`,
		"missing editting_order":  `{"submitted_order_id": null}`,
		"broken editting_order":   broken,
		"editting_order is array": `{"editting_order": []}`,
	}
	for name, body := range cases {
		if res := api.do(http.MethodPut, "/api/cashier-state", body); res.Code != http.StatusBadRequest {
			t.Errorf("%s: status = %d, want 400: %s", name, res.Code, res.Body)
		}
	}

	// 壊れた状態は保存も配信もしない
	var got models.CashierStateResponse
	api.do(http.MethodGet, "/api/cashier-state", nil).expect(http.StatusOK).decode(&got)
	if got.EdittingOrder["orderId"] != 1.0 {
		t.Fatalf("state changed: %+v", got)
	}
	api.noBroadcast()
}

func TestMasterStatus(t *testing.T) {
	api := newTestAPI(t)

	var states []models.MasterStateResponse
	api.do(http.MethodGet, "/api/master-status", nil).expect(http.StatusOK).decode(&states)
	if len(states) != 0 {
		t.Fatalf("states: %+v", states)
	}

	// GET と同じ（小文字のキーの）形で返す
	res := api.do(http.MethodPost, "/api/master-status", models.MasterStateUpdateRequest{Type: "stop"}).expect(http.StatusCreated)
	var created map[string]any
	res.decode(&created)
	if created["type"] != "stop" || created["created_at"] == nil {
		t.Fatalf("created: %s", res.Body)
	}
	msg := api.nextBroadcast()
	if msg.Type != WSMessageTypeMasterState || msg.MasterState == nil || msg.MasterState.Type != "stop" {
		t.Fatalf("broadcast: %+v", msg)
	}

	// 配信するのは最新の状態
	api.do(http.MethodPost, "/api/master-status", models.MasterStateUpdateRequest{Type: "start"}).expect(http.StatusCreated)
	if msg := api.nextBroadcast(); msg.MasterState == nil || msg.MasterState.Type != "start" {
		t.Fatalf("broadcast: %+v", msg)
	}

	api.do(http.MethodGet, "/api/master-status", nil).expect(http.StatusOK).decode(&states)
	if len(states) != 2 {
		t.Fatalf("states: %+v", states)
	}

	api.do(http.MethodPost, "/api/master-status", `{`).expect(http.StatusBadRequest)
	api.noBroadcast()
}

// 接続直後に、今の注文・オーダーストップ・レジの状態をその端末にだけ送る
func TestWSSendsCurrentStateOnConnect(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	order := api.createOrder(3, m.pairMenu)
	api.do(http.MethodPost, "/api/master-status", models.MasterStateUpdateRequest{Type: "stop"}).expect(http.StatusCreated)
	api.nextBroadcast()
	api.do(http.MethodPut, "/api/cashier-state", cashierStateRequest(t, nil)).expect(http.StatusOK)
	api.nextBroadcast()

	srv := httptest.NewServer(api.router)
	t.Cleanup(srv.Close)
	conn := dialWS(t, "ws"+strings.TrimPrefix(srv.URL, "http")+"/api/ws/orders")

	orders := readWS(t, conn)
	if orders.Type != WSMessageTypeOrders || len(orders.Orders) != 1 || orders.Orders[0].Id != order.Id || len(orders.Orders[0].Cups) != 2 {
		t.Fatalf("orders: %+v", orders)
	}
	if msg := readWS(t, conn); msg.Type != WSMessageTypeMasterState || msg.MasterState.Type != "stop" {
		t.Fatalf("master state: %+v", msg)
	}
	if msg := readWS(t, conn); msg.Type != WSMessageTypeCashierState || msg.CashierState.EdittingOrder["orderId"] != 1.0 {
		t.Fatalf("cashier state: %+v", msg)
	}
	// 既にいた端末には初期データを配り直さない
	api.noBroadcast()

	// そのあとの変更は、つないだ端末にも届く
	api.do(http.MethodPatch, "/api/orders/"+order.Id.String()+"/ready", nil).expect(http.StatusOK)
	if msg := readWS(t, conn); msg.Type != WSMessageTypeOrder || msg.Order.ReadyAt == nil {
		t.Fatalf("order: %+v", msg)
	}
}

// 並行する PUT の配信は、保存した順に届く（最後に届いたものが DB の状態と一致する）
func TestConcurrentCashierStateBroadcastsMatchSavedOrder(t *testing.T) {
	api := newTestAPI(t)

	const n = 10
	done := make(chan struct{}, n)
	for i := range n {
		req := cashierStateRequest(t, nil)
		req.EdittingOrder["orderId"] = float64(i)
		data, err := json.Marshal(req)
		if err != nil {
			t.Fatal(err)
		}
		go func() {
			defer func() { done <- struct{}{} }()
			api.do(http.MethodPut, "/api/cashier-state", string(data))
		}()
	}
	for range n {
		select {
		case <-done:
		case <-time.After(5 * time.Second):
			t.Fatal("requests did not finish")
		}
	}

	var last WSMessage
	for range n {
		last = api.nextBroadcast()
	}
	var got models.CashierStateResponse
	api.do(http.MethodGet, "/api/cashier-state", nil).expect(http.StatusOK).decode(&got)
	if last.CashierState.EdittingOrder["orderId"] != got.EdittingOrder["orderId"] {
		t.Fatalf("last broadcast %v differs from saved %v", last.CashierState.EdittingOrder["orderId"], got.EdittingOrder["orderId"])
	}
}
