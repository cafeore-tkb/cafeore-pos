package handlers

import (
	"net/http"
	"strings"
	"testing"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"cafeore-pos/api/internal/models"
)

// 分けた注文（1 人の注文を注文番号ごとに分け、まとめて 1 回で払う）の作成・キャンセル・現金の返金・削除

// createSplitGroup は No.20（ブレンド）を 1 つ目に、No.21（アイスコーヒー）・No.22（ブレンド、引換券で 1 杯引き）に
// 分けた注文を現金 2000 円で作り、1 つ目の注文と、配った注文の ID（配った順）を返す。
func (a *testAPI) createSplitGroup(key uuid.UUID) (models.OrderResponse, []uuid.UUID) {
	a.t.Helper()
	m := a.seedMaster()
	discountOrder, discountCups := 5, 1
	var resp models.OrderResponse
	a.do(http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId: 20, BillingAmount: 400, MenuIds: []models.MenuInfoCreate{menuLine(m.blendMenu)},
		Payments: &[]models.OrderPaymentCreate{cashPayment(1150, 2000, 0)},
		SplitOrders: &[]models.SplitOrderCreate{
			{OrderId: 21, BillingAmount: 450, MenuIds: []models.MenuInfoCreate{menuLine(m.iceMenu)}},
			{
				OrderId: 22, BillingAmount: 300, MenuIds: []models.MenuInfoCreate{menuLine(m.blendMenu)},
				DiscountOrderId: &discountOrder, DiscountOrderCups: &discountCups,
			},
		},
		IdempotencyKey: (*openapi_types.UUID)(&key),
	}).expect(http.StatusCreated).decode(&resp)
	published := make([]uuid.UUID, 3)
	for i := range published {
		msg := a.nextBroadcast()
		if msg.Type != WSMessageTypeOrder {
			a.t.Fatalf("broadcast %d: %+v", i, msg)
		}
		published[i] = uuid.UUID(msg.Order.Id)
	}
	return resp, published
}

func TestCreateSplitGroup(t *testing.T) {
	api := newTestAPI(t)
	key := uuid.New()
	parent, published := api.createSplitGroup(key)

	// 1 つ目の注文が支払いをまとめて持つ
	if parent.OrderId != 20 || parent.BillingAmount != 400 || parent.Received != 2000 || parent.SplitParentId != nil ||
		len(parent.Payments) != 1 || parent.Payments[0].Amount != 1150 {
		t.Fatalf("parent: %+v", parent)
	}
	// 分けた注文を先に、1 つ目の注文を最後に配る
	if published[2] != uuid.UUID(parent.Id) {
		t.Fatalf("published: %v", published)
	}
	var children []models.Order
	if err := preloadOrder(api.db).Where("split_parent_id = ?", parent.Id).Order("order_id").Find(&children).Error; err != nil {
		t.Fatal(err)
	}
	if len(children) != 2 {
		t.Fatalf("children: %+v", children)
	}
	for i, child := range children {
		if child.ID != published[i] {
			t.Errorf("children[%d] published as %s", i, published[i])
		}
		// 分けた注文はお預かり 0・支払い無しで、支払い方法は 1 つ目と同じ
		if child.Received != 0 || len(child.Payments) != 0 || child.PaymentMethod != string(models.Cash) ||
			!child.CreatedAt.Equal(api.loadOrder(uuid.UUID(parent.Id)).CreatedAt) || len(child.OrderCups) != 1 {
			t.Errorf("children[%d]: %+v", i, child)
		}
	}
	if children[0].OrderId != 21 || children[0].BillingAmount != 450 ||
		children[1].OrderId != 22 || children[1].BillingAmount != 300 || children[1].DiscountOrderId != 5 || children[1].DiscountOrderCups != 1 {
		t.Fatalf("children: %+v", children)
	}

	// 一覧では 2 つ目以降に、分けた元の注文が付く
	var orders []models.OrderResponse
	api.do(http.MethodGet, "/api/orders", nil).expect(http.StatusOK).decode(&orders)
	for _, order := range orders {
		wantParent := order.OrderId != 20
		if gotParent := order.SplitParentId != nil && *order.SplitParentId == parent.Id; gotParent != wantParent {
			t.Errorf("No.%d split_parent_id: %v", order.OrderId, order.SplitParentId)
		}
	}

	// 送り直しは分けた注文も二重に作らない
	var again models.OrderResponse
	api.do(http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId: 20, BillingAmount: 400, MenuIds: []models.MenuInfoCreate{{MenuId: parent.Menus[0].Menu.Id}},
		Payments:       &[]models.OrderPaymentCreate{cashPayment(400, 400, 0)},
		IdempotencyKey: (*openapi_types.UUID)(&key),
	}).expect(http.StatusOK).decode(&again)
	if again.Id != parent.Id || api.count(&models.Order{}, "") != 3 {
		t.Fatalf("retry created orders: %+v", again)
	}
}

func TestCreateSplitGroupRejectsInvalidRequests(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	lines := []models.MenuInfoCreate{menuLine(m.blendMenu)}
	child := []models.SplitOrderCreate{{OrderId: 2, BillingAmount: 450, MenuIds: []models.MenuInfoCreate{menuLine(m.iceMenu)}}}

	cases := []struct {
		name    string
		request models.OrderCreateRequest
		message string
	}{
		{"no payments", models.OrderCreateRequest{OrderId: 1, BillingAmount: 400, Received: 850, MenuIds: lines, SplitOrders: &child}, "payments も指定"},
		{"payments for the first order only", models.OrderCreateRequest{
			OrderId: 1, BillingAmount: 400, MenuIds: lines, SplitOrders: &child,
			Payments: &[]models.OrderPaymentCreate{cashPayment(400, 400, 0)},
		}, "一致しません"},
		{"empty split orders", models.OrderCreateRequest{
			OrderId: 1, BillingAmount: 400, MenuIds: lines, SplitOrders: &[]models.SplitOrderCreate{},
			Payments: &[]models.OrderPaymentCreate{cashPayment(400, 400, 0)},
		}, "空にはできません"},
		{"split order without lines", models.OrderCreateRequest{
			OrderId: 1, BillingAmount: 400, MenuIds: lines, SplitOrders: &[]models.SplitOrderCreate{{OrderId: 2, BillingAmount: 0}},
			Payments: &[]models.OrderPaymentCreate{cashPayment(400, 400, 0)},
		}, "menu_ids が空"},
	}
	for _, c := range cases {
		resp := api.do(http.MethodPost, "/api/orders", c.request).expect(http.StatusBadRequest)
		if !strings.Contains(string(resp.Body), c.message) {
			t.Errorf("%s: %s", c.name, resp.Body)
		}
	}
	if n := api.count(&models.Order{}, ""); n != 0 {
		t.Errorf("%d orders created", n)
	}
	api.noBroadcast()
}

func TestSplitGroupIsCancelledRefundedAndDeletedTogether(t *testing.T) {
	api := newTestAPI(t)
	parent, published := api.createSplitGroup(uuid.New())
	child := published[0]

	// 分けた注文のどれをキャンセルしても、まとめてキャンセルする（応答は指定した注文）
	var cancelled models.OrderResponse
	api.do(http.MethodPost, "/api/orders/"+child.String()+"/cancel", nil).expect(http.StatusOK).decode(&cancelled)
	if uuid.UUID(cancelled.Id) != child || cancelled.CancelledAt == nil {
		t.Fatalf("cancelled: %+v", cancelled)
	}
	for _, id := range published {
		if api.loadOrder(id).CancelledAt == nil {
			t.Errorf("order %s must be cancelled", id)
		}
	}
	for range published {
		if msg := api.nextBroadcast(); msg.Type != WSMessageTypeOrder {
			t.Fatalf("broadcast: %+v", msg)
		}
	}

	// 現金の返金は、支払いを持つ 1 つ目に記録する
	api.do(http.MethodPost, "/api/orders/"+child.String()+"/cash-refund", nil).expect(http.StatusOK)
	if api.loadOrder(uuid.UUID(parent.Id)).CashRefundedAt == nil {
		t.Error("cash refund must be recorded on the first order")
	}
	if api.loadOrder(child).CashRefundedAt != nil {
		t.Error("cash refund must not be recorded on a split order")
	}
	for range published {
		api.nextBroadcast()
	}

	// 消すときもまとめて消す
	api.do(http.MethodDelete, "/api/orders/"+child.String(), nil).expect(http.StatusOK)
	if n := api.count(&models.Order{}, ""); n != 0 {
		t.Errorf("%d orders left", n)
	}
	if n := api.count(&models.OrderPayment{}, ""); n != 0 {
		t.Errorf("%d payments left", n)
	}
	deleted := map[uuid.UUID]bool{}
	for range published {
		msg := api.nextBroadcast()
		if msg.Type != WSMessageTypeOrderDeleted {
			t.Fatalf("broadcast: %+v", msg)
		}
		deleted[*msg.OrderID] = true
	}
	for _, id := range published {
		if !deleted[id] {
			t.Errorf("deletion of %s was not published", id)
		}
	}
}
