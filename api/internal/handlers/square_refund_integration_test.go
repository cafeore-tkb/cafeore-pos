package handlers

// Square の返金を、実際の Postgres と偽の Square サーバーで通しで確かめる。
// 動かし方は square_integration_test.go の先頭を参照。

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/square"
)

// pay は端末で 600 円の支払いが終わり、レジが受取額を確かめた決済依頼を作る。
func (e *integrationEnv) pay() models.SquareCheckoutResponse {
	e.t.Helper()
	code, checkout, _ := e.createCheckout(uuid.NewString(), 600)
	if code != http.StatusCreated {
		e.t.Fatalf("create checkout: %d", code)
	}
	e.fake.complete(*checkout.CheckoutId, 600)
	var polled models.SquareCheckoutResponse
	e.call(http.MethodGet, "/api/square/checkouts/"+checkout.Id.String(), nil, nil, &polled)
	if polled.Outcome != models.Paid {
		e.t.Fatalf("checkout not paid: %+v", polled)
	}
	return polled
}

// payAndOrder は Square で払った注文を作り、その決済依頼と注文の ID を返す。
func (e *integrationEnv) payAndOrder(orderNumber int) (models.SquareCheckoutResponse, string) {
	e.t.Helper()
	checkout := e.pay()
	checkoutID := uuid.UUID(checkout.Id)
	code, order := e.createOrder(orderNumber, 600, &checkoutID)
	if code != http.StatusCreated {
		e.t.Fatalf("order: %d %v", code, order)
	}
	return checkout, order["id"].(string)
}

func (e *integrationEnv) refundOrder(orderID string) (int, models.SquareCheckoutResponse, map[string]any) {
	e.t.Helper()
	return e.refund("/api/orders/" + orderID + "/square-refund")
}

func (e *integrationEnv) refundCheckout(id string) (int, models.SquareCheckoutResponse, map[string]any) {
	e.t.Helper()
	return e.refund("/api/square/checkouts/" + id + "/refund")
}

// refund は返金を頼み、決済依頼として読めればそれを、読めなければ本文をそのまま返す。
func (e *integrationEnv) refund(path string) (int, models.SquareCheckoutResponse, map[string]any) {
	e.t.Helper()
	var raw map[string]any
	code := e.call(http.MethodPost, path, nil, nil, &raw)
	var checkout models.SquareCheckoutResponse
	if _, ok := raw["id"]; ok {
		encoded, _ := json.Marshal(raw)
		_ = json.Unmarshal(encoded, &checkout)
	}
	return code, checkout, raw
}

func (e *integrationEnv) orderCount() int64 {
	e.t.Helper()
	var count int64
	e.db.Model(&models.Order{}).Count(&count)
	return count
}

func (e *integrationEnv) unlinked() []models.SquareCheckoutResponse {
	e.t.Helper()
	var unlinked []models.SquareCheckoutResponse
	if code := e.call(http.MethodGet, "/api/square/checkouts/unlinked", nil, nil, &unlinked); code != http.StatusOK {
		e.t.Fatalf("unlinked: %d", code)
	}
	return unlinked
}

func TestSquareIntegrationRefundOrder(t *testing.T) {
	env := newIntegrationEnv(t)
	checkout, orderID := env.payAndOrder(1)

	code, refunded, raw := env.refundOrder(orderID)
	if code != http.StatusOK || refunded.RefundStatus != models.RefundPending || refunded.OrderId != nil {
		t.Fatalf("refund: %d %v", code, raw)
	}
	if len(env.fake.refundRequests) != 1 {
		t.Fatalf("expected one refund request, got %d", len(env.fake.refundRequests))
	}
	sent := env.fake.refundRequests[0]
	amount, _ := sent["amount_money"].(map[string]any)
	key, _ := sent["idempotency_key"].(string)
	if sent["payment_id"] != checkout.PaymentIds[0] || amount["amount"] != float64(600) || amount["currency"] != "JPY" ||
		sent["reason"] != "No.12 の返金" || key == "" || len(key) > 45 {
		t.Fatalf("unexpected refund request: %v", sent)
	}
	// 返金を受け付けたら注文は消える。決済は照合の一覧に返金待ちとして出る。
	if count := env.orderCount(); count != 0 {
		t.Fatalf("order must be deleted, %d left", count)
	}
	unlinked := env.unlinked()
	if len(unlinked) != 1 || unlinked[0].Id != checkout.Id || unlinked[0].RefundStatus != models.RefundPending {
		t.Fatalf("unlinked while refunding: %+v", unlinked)
	}
	// 返金中の決済では注文を作れない。
	checkoutID := uuid.UUID(checkout.Id)
	if code, body := env.createOrder(2, 600, &checkoutID); code != http.StatusConflict {
		t.Fatalf("order with a refunded checkout: %d %v", code, body)
	}
	// もう一度押しても Square には頼まない。
	if code, again, _ := env.refundCheckout(checkout.Id.String()); code != http.StatusOK || again.RefundStatus != models.RefundPending {
		t.Fatalf("refund again: %d %+v", code, again)
	}
	if len(env.fake.refundRequests) != 1 {
		t.Fatalf("refund must not be requested twice, got %d", len(env.fake.refundRequests))
	}

	// Square で返金が終わると、一覧から消える。
	env.fake.completeRefund("rf_1")
	if unlinked := env.unlinked(); len(unlinked) != 0 {
		t.Fatalf("refunded checkout must leave the list: %+v", unlinked)
	}
	var polled models.SquareCheckoutResponse
	env.call(http.MethodGet, "/api/square/checkouts/"+checkout.Id.String(), nil, nil, &polled)
	if polled.RefundStatus != models.RefundRefunded {
		t.Fatalf("after refund: %+v", polled)
	}

	// 現金の注文や無い注文には Square の決済が無い。
	code, cash := env.createOrder(3, 600, nil)
	if code != http.StatusCreated {
		t.Fatalf("cash order: %d", code)
	}
	if code, _, _ := env.refundOrder(cash["id"].(string)); code != http.StatusNotFound {
		t.Fatalf("cash order refund: %d", code)
	}
	if code, _, _ := env.refundOrder(uuid.NewString()); code != http.StatusNotFound {
		t.Fatalf("unknown order refund: %d", code)
	}
}

// 交通系 IC のように Square が返金を断ったら、注文は残し、断られたことを返す。
func TestSquareIntegrationRefundDeclined(t *testing.T) {
	env := newIntegrationEnv(t)
	checkout, orderID := env.payAndOrder(1)
	env.fake.declinePayments[checkout.PaymentIds[0]] = true

	code, declined, raw := env.refundOrder(orderID)
	if code != http.StatusBadGateway || declined.RefundStatus != models.RefundFailed ||
		declined.RefundError == nil || !strings.Contains(*declined.RefundError, "REFUND_DECLINED") {
		t.Fatalf("declined: %d %v", code, raw)
	}
	if count := env.orderCount(); count != 1 {
		t.Fatalf("order must stay when the refund is declined, %d left", count)
	}

	// 断られた後でも、もう一度頼める。
	env.fake.declinePayments[checkout.PaymentIds[0]] = false
	if code, refunded, raw := env.refundOrder(orderID); code != http.StatusOK || refunded.RefundStatus != models.RefundPending {
		t.Fatalf("retry: %d %v", code, raw)
	}
	if count := env.orderCount(); count != 0 {
		t.Fatalf("order must be deleted after the retry, %d left", count)
	}
}

// 返金の応答が失われても、頼み直しで二重に返金しない。
func TestSquareIntegrationRefundResponseLost(t *testing.T) {
	env := newIntegrationEnv(t)
	checkout := env.pay()
	env.fake.loseRefunds = 1

	code, lost, raw := env.refundCheckout(checkout.Id.String())
	if code != http.StatusBadGateway || lost.RefundStatus != models.RefundFailed || lost.RefundError == nil {
		t.Fatalf("lost response: %d %v", code, raw)
	}
	// 結果が分からない間は注文に使えない。
	checkoutID := uuid.UUID(checkout.Id)
	if code, body := env.createOrder(1, 600, &checkoutID); code != http.StatusConflict {
		t.Fatalf("order while the refund is uncertain: %d %v", code, body)
	}

	code, refunded, raw := env.refundCheckout(checkout.Id.String())
	if code != http.StatusOK || refunded.RefundStatus != models.RefundPending || refunded.RefundError != nil {
		t.Fatalf("retry: %d %v", code, raw)
	}
	if len(env.fake.refunds) != 1 {
		t.Fatalf("expected exactly one refund at Square, got %d", len(env.fake.refunds))
	}
}

// Square の管理画面で返金済みの決済は、Square に頼まずに返金済みにして注文を消す。
func TestSquareIntegrationRefundAlreadyRefunded(t *testing.T) {
	env := newIntegrationEnv(t)
	checkout, orderID := env.payAndOrder(1)
	env.fake.mu.Lock()
	paymentID := checkout.PaymentIds[0]
	env.fake.refunds["rf_dashboard"] = &square.PaymentRefund{
		ID: "rf_dashboard", Status: "COMPLETED", PaymentID: paymentID, AmountMoney: square.Money{Amount: 600, Currency: "JPY"},
	}
	env.fake.payments[paymentID].RefundIDs = []string{"rf_dashboard"}
	env.fake.payments[paymentID].RefundedMoney = &square.Money{Amount: 600, Currency: "JPY"}
	env.fake.mu.Unlock()

	code, refunded, raw := env.refundOrder(orderID)
	if code != http.StatusOK || refunded.RefundStatus != models.RefundRefunded {
		t.Fatalf("refund: %d %v", code, raw)
	}
	if len(env.fake.refundRequests) != 0 {
		t.Fatalf("must not refund twice: %v", env.fake.refundRequests)
	}
	if count := env.orderCount(); count != 0 {
		t.Fatalf("order must be deleted, %d left", count)
	}
	if unlinked := env.unlinked(); len(unlinked) != 0 {
		t.Fatalf("refunded checkout must not be listed: %+v", unlinked)
	}
}

// 同時に押されても、Square に頼む返金は 1 件だけ。
func TestSquareIntegrationConcurrentRefund(t *testing.T) {
	env := newIntegrationEnv(t)
	checkout, _ := env.payAndOrder(1)
	const requests = 6
	codes := make([]int, requests)
	var wg sync.WaitGroup
	start := make(chan struct{})
	for i := range requests {
		path := "/api/square/checkouts/" + checkout.Id.String() + "/refund"
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			req := httptest.NewRequest(http.MethodPost, path, bytes.NewReader(nil))
			rec := httptest.NewRecorder()
			env.router.ServeHTTP(rec, req)
			codes[i] = rec.Code
		}()
	}
	close(start)
	wg.Wait()

	if len(env.fake.refundRequests) != 1 || len(env.fake.refunds) != 1 {
		t.Fatalf("expected exactly one refund, got %d requests (codes %v)", len(env.fake.refundRequests), codes)
	}
	for i, code := range codes {
		if code != http.StatusOK && code != http.StatusConflict {
			t.Fatalf("request %d: %d", i, code)
		}
	}
	if count := env.orderCount(); count != 0 {
		t.Fatalf("order must be deleted, %d left", count)
	}
}

// 決済の額が読めないときは、返金済みとみなさずに断る（返金せずに注文を消さない）。
func TestSquareIntegrationRefundUnknownAmount(t *testing.T) {
	env := newIntegrationEnv(t)
	checkout, orderID := env.payAndOrder(1)
	env.fake.mu.Lock()
	env.fake.payments[checkout.PaymentIds[0]].AmountMoney = square.Money{}
	env.fake.mu.Unlock()

	code, failed, raw := env.refundOrder(orderID)
	if code != http.StatusBadGateway || failed.RefundStatus != models.RefundFailed {
		t.Fatalf("unknown amount: %d %v", code, raw)
	}
	if len(env.fake.refundRequests) != 0 || env.orderCount() != 1 {
		t.Fatalf("must neither refund nor delete the order: %d requests, %d orders", len(env.fake.refundRequests), env.orderCount())
	}
}
