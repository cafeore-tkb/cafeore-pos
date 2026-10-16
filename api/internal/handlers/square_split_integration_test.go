package handlers

// 個別会計（1 つの注文に Square の決済を複数）を、実際の Postgres と偽の Square サーバーで通しで確かめる。
// 動かし方は square_integration_test.go の先頭を参照。

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
)

// createSplitOrder は 600 円の明細 3 つの注文を、支払いを分けて作る。
func (e *integrationEnv) createSplitOrder(orderNumber int, payments ...map[string]any) (int, map[string]any) {
	e.t.Helper()
	line := map[string]any{"menu_id": e.menuID, "assignee": nil}
	body := map[string]any{
		"order_id": orderNumber, "billing_amount": 1800, "received": 0,
		"menu_ids": []map[string]any{line, line, line},
		"payments": payments,
	}
	var out map[string]any
	status := e.call(http.MethodPost, "/api/orders", body, nil, &out)
	return status, out
}

func squareSplitPayment(checkout models.SquareCheckoutResponse, amount int, indexes ...int) map[string]any {
	return map[string]any{"method": "square", "amount": amount, "received": 0, "square_checkout_id": checkout.Id.String(), "menu_indexes": indexes}
}

func cashSplitPayment(amount, received int, indexes ...int) map[string]any {
	return map[string]any{"method": "cash", "amount": amount, "received": received, "menu_indexes": indexes}
}

func TestSquareIntegrationSplitOrder(t *testing.T) {
	env := newIntegrationEnv(t)
	first, second := env.pay(), env.pay()

	// 決済額と支払いの額が合わなければ作らない（どちらの決済も結び付けない）
	code, body := env.createSplitOrder(1,
		squareSplitPayment(first, 600, 0), cashSplitPayment(700, 1000, 1), squareSplitPayment(second, 500, 2))
	if code != http.StatusConflict {
		t.Fatalf("amount mismatch: %d %v", code, body)
	}
	if count := env.orderCount(); count != 0 {
		t.Fatalf("order must not be created, %d", count)
	}
	if unlinked := env.unlinked(); len(unlinked) != 2 {
		t.Fatalf("both checkouts must stay unlinked: %+v", unlinked)
	}

	code, body = env.createSplitOrder(1,
		squareSplitPayment(first, 600, 0), cashSplitPayment(600, 1000, 1), squareSplitPayment(second, 600, 2))
	if code != http.StatusCreated {
		t.Fatalf("split order: %d %v", code, body)
	}
	orderID := body["id"].(string)
	order := env.getOrder(orderID)
	if order.PaymentMethod != models.Square || order.Received != 2200 || refundStatusOf(order) != string(models.RefundNone) || len(order.Payments) != 3 {
		t.Fatalf("order: %+v", order)
	}
	for i, payment := range order.Payments {
		if len(payment.OrderMenuIds) != 1 || payment.OrderMenuIds[0] != order.Menus[i].Id {
			t.Errorf("payments[%d] lines: %+v", i, payment.OrderMenuIds)
		}
	}
	if p := order.Payments[0]; p.SquareCheckoutId == nil || *p.SquareCheckoutId != first.Id || p.SquarePaymentType == nil || *p.SquarePaymentType != "CARD_PRESENT" ||
		p.SquareRefundStatus == nil || *p.SquareRefundStatus != models.RefundNone || p.Received != 600 {
		t.Errorf("payments[0]: %+v", p)
	}
	if p := order.Payments[1]; p.Method != models.Cash || p.Received != 1000 || p.SquareCheckoutId != nil || p.SquareRefundStatus != nil {
		t.Errorf("payments[1]: %+v", p)
	}
	if unlinked := env.unlinked(); len(unlinked) != 0 {
		t.Fatalf("both checkouts must be linked: %+v", unlinked)
	}
	// 結び付けた決済は別の注文には使えない
	if code, _ := env.createOrder(2, 600, (*uuid.UUID)(&second.Id)); code != http.StatusConflict {
		t.Fatalf("reusing a split checkout: %d", code)
	}

	// 2 つ目の決済は断られる。1 つ目だけ受け付け、注文は残す
	env.fake.declinePayments[second.PaymentIds[0]] = true
	published := env.watchOrders()
	code, declined, raw := env.refundOrderKeepingOrder(orderID)
	if code != http.StatusBadGateway || declined.Id != second.Id || declined.RefundStatus != models.RefundFailed {
		t.Fatalf("declined: %d %v", code, raw)
	}
	// 偽の Square は断った依頼も記録する
	if len(env.fake.refundRequests) != 2 || env.fake.refundRequests[0]["payment_id"] != first.PaymentIds[0] ||
		env.fake.refundRequests[1]["payment_id"] != second.PaymentIds[0] {
		t.Fatalf("refund requests: %v", env.fake.refundRequests)
	}
	if got := refundStatusOf(published(orderID)); got != string(models.RefundFailed) {
		t.Fatalf("published after declined: %s", got)
	}

	// もう一度押すと、受け付け済みの 1 つ目は頼み直さず、2 つ目だけを頼んで注文を消す
	env.fake.declinePayments[second.PaymentIds[0]] = false
	code, refunded, raw := env.refundOrder(orderID)
	if code != http.StatusOK || refunded.RefundStatus != models.RefundPending || refunded.OrderId != nil {
		t.Fatalf("refund: %d %v", code, raw)
	}
	if len(env.fake.refundRequests) != 3 || env.fake.refundRequests[2]["payment_id"] != second.PaymentIds[0] {
		t.Fatalf("refund requests: %v", env.fake.refundRequests)
	}
	if count := env.orderCount(); count != 0 {
		t.Fatalf("order must be deleted, %d left", count)
	}
	var payments int64
	env.db.Model(&models.OrderPayment{}).Count(&payments)
	if payments != 0 {
		t.Fatalf("payments must be deleted, %d left", payments)
	}
	// 2 つの決済は返金待ちとして照合の一覧に戻る
	if unlinked := env.unlinked(); len(unlinked) != 2 {
		t.Fatalf("unlinked after refund: %+v", unlinked)
	}
}
