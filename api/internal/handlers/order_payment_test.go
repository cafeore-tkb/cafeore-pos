package handlers

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

// 個別会計（1 つの注文に支払いを複数）の作成・取得・編集・削除

func cashPayment(amount, received int, indexes ...int) models.OrderPaymentCreate {
	return models.OrderPaymentCreate{Method: models.Cash, Amount: amount, Received: received, MenuIndexes: &indexes}
}

func squarePayment(amount int, checkoutID uuid.UUID, indexes ...int) models.OrderPaymentCreate {
	id := openapi_types.UUID(checkoutID)
	return models.OrderPaymentCreate{Method: models.Square, Amount: amount, Received: 0, SquareCheckoutId: &id, MenuIndexes: &indexes}
}

func TestOrderPaymentsFromRequest(t *testing.T) {
	lines := []models.MenuInfoCreate{{}, {}, {}}
	checkout := uuid.New()
	request := func(billing int, payments ...models.OrderPaymentCreate) models.CreateOrderJSONRequestBody {
		return models.CreateOrderJSONRequestBody{BillingAmount: billing, MenuIds: lines, Payments: &payments}
	}

	if payments, indexes, err := orderPaymentsFromRequest(models.CreateOrderJSONRequestBody{BillingAmount: 500, MenuIds: lines}); err != nil || payments != nil || indexes != nil {
		t.Fatalf("without payments: %v %v %v", payments, indexes, err)
	}

	discount := 100
	withDiscount := cashPayment(800, 1000, 0, 2)
	withDiscount.Discount = &discount
	payments, indexes, err := orderPaymentsFromRequest(request(1400, withDiscount, squarePayment(600, checkout, 1)))
	if err != nil {
		t.Fatal(err)
	}
	if len(payments) != 2 ||
		payments[0].Position != 0 || payments[0].Method != "cash" || payments[0].Amount != 800 || payments[0].Received != 1000 || payments[0].Discount != 100 ||
		payments[1].Position != 1 || payments[1].Method != "square" || payments[1].Received != 600 || *payments[1].SquareCheckoutID != checkout {
		t.Fatalf("payments: %+v", payments)
	}
	if len(indexes) != 2 || len(indexes[0]) != 2 || indexes[0][1] != 2 || len(indexes[1]) != 1 || indexes[1][0] != 1 {
		t.Fatalf("indexes: %v", indexes)
	}

	square := models.Square
	invalid := map[string]models.CreateOrderJSONRequestBody{
		"empty":                    request(0),
		"sum differs from billing": request(1000, cashPayment(500, 500, 0), cashPayment(400, 400, 1)),
		"not enough cash received": request(500, cashPayment(500, 400, 0)),
		"negative amount":          request(-100, cashPayment(-100, 0, 0)),
		"square without checkout":  request(500, models.OrderPaymentCreate{Method: models.Square, Amount: 500}),
		"cash with checkout":       request(500, models.OrderPaymentCreate{Method: models.Cash, Amount: 500, Received: 500, SquareCheckoutId: squarePayment(500, checkout).SquareCheckoutId}),
		"same checkout twice":      request(1000, squarePayment(500, checkout, 0), squarePayment(500, checkout, 1)),
		"same line twice":          request(1000, cashPayment(500, 500, 0), cashPayment(500, 500, 0)),
		"line out of range":        request(500, cashPayment(500, 500, 3)),
		"unknown method":           request(500, models.OrderPaymentCreate{Method: "card", Amount: 500, Received: 500}),
		"with payment_method":      {BillingAmount: 500, MenuIds: lines, PaymentMethod: &square, Payments: &[]models.OrderPaymentCreate{cashPayment(500, 500)}},
		"with square_checkout_id":  {BillingAmount: 500, MenuIds: lines, SquareCheckoutId: squarePayment(500, checkout).SquareCheckoutId, Payments: &[]models.OrderPaymentCreate{cashPayment(500, 500)}},
		"negative discount":        request(500, models.OrderPaymentCreate{Method: models.Cash, Amount: 500, Received: 500, Discount: &[]int{-1}[0]}),
	}
	for name, req := range invalid {
		if _, _, err := orderPaymentsFromRequest(req); err == nil {
			t.Errorf("%s: must be rejected", name)
		}
	}
}

func TestSquareRefundOutcomeOf(t *testing.T) {
	now := time.Now()
	none := *paidRecord(nil)
	pending := *withRefund(squareRefundPending, nil)
	refunded := *withRefund(squareRefundCompleted, nil)
	failed := *withRefund(squareRefundFailed, nil)
	unknown := *withRefund(squareRefundRequesting, func(r *models.SquareCheckout) { r.RefundRequestedAt = nil })
	cases := []struct {
		name      string
		checkouts []models.SquareCheckout
		want      models.SquareRefundStatus
	}{
		{"one, not refunded", []models.SquareCheckout{none}, models.RefundNone},
		{"none of two", []models.SquareCheckout{none, none}, models.RefundNone},
		{"all refunded", []models.SquareCheckout{refunded, refunded}, models.RefundRefunded},
		{"waiting for one", []models.SquareCheckout{refunded, pending}, models.RefundPending},
		{"one declined", []models.SquareCheckout{pending, failed}, models.RefundFailed},
		{"one unknown", []models.SquareCheckout{refunded, unknown}, models.RefundUnknown},
		// 途中で止まった（残りを頼んでいない）ら、もう一度押せるよう failed
		{"stopped halfway", []models.SquareCheckout{pending, none}, models.RefundFailed},
	}
	for _, c := range cases {
		if got := squareRefundOutcomeOf(c.checkouts, now); got != c.want {
			t.Errorf("%s: %s, want %s", c.name, got, c.want)
		}
	}
}

func TestCreateSplitOrderSavesPayments(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()

	// ペアセット 900（ブレンド 2 杯）・ブレンド 400・アイスコーヒー 450。引換券で 1 杯 100 円引き
	discount := 100
	first := cashPayment(800, 1000, 0)
	first.Discount = &discount
	var resp models.OrderResponse
	api.do(http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId:           8,
		BillingAmount:     1650,
		Received:          0,
		DiscountOrderCups: &[]int{1}[0],
		MenuIds:           []models.MenuInfoCreate{menuLine(m.pairMenu), menuLine(m.blendMenu), menuLine(m.iceMenu)},
		Payments:          &[]models.OrderPaymentCreate{first, cashPayment(850, 900, 1, 2)},
	}).expect(http.StatusCreated).decode(&resp)

	// お預かりは合計、Square を含まないので現金
	if resp.Received != 1900 || resp.PaymentMethod != models.Cash || resp.SquareRefundStatus != nil {
		t.Fatalf("order: %+v", resp)
	}
	if len(resp.Payments) != 2 {
		t.Fatalf("payments: %+v", resp.Payments)
	}
	p0, p1 := resp.Payments[0], resp.Payments[1]
	if p0.Method != models.Cash || p0.Amount != 800 || p0.Received != 1000 || p0.Discount != 100 ||
		len(p0.OrderMenuIds) != 1 || p0.OrderMenuIds[0] != resp.Menus[0].Id || p0.SquareCheckoutId != nil {
		t.Errorf("payments[0]: %+v", p0)
	}
	if p1.Amount != 850 || p1.Received != 900 || p1.Discount != 0 ||
		len(p1.OrderMenuIds) != 2 || p1.OrderMenuIds[0] != resp.Menus[1].Id || p1.OrderMenuIds[1] != resp.Menus[2].Id {
		t.Errorf("payments[1]: %+v", p1)
	}
	api.nextBroadcast()

	// 一括で払った注文には支払いが無い
	if single := api.createOrder(9, m.blendMenu); len(single.Payments) != 0 {
		t.Errorf("single payment order: %+v", single.Payments)
	}

	// 注文を編集してアイスコーヒーを外すと、その支払いの明細からも外れる（支払いはそのまま）
	var updated models.OrderResponse
	api.do(http.MethodPut, "/api/orders/"+resp.Id.String(), models.OrderUpdateRequest{
		Id: resp.Id, OrderId: 8, BillingAmount: 1200, Received: 1900,
		MenuIds: []models.MenuInfoCreate{
			{MenuId: m.pairMenu.ID, OrderMenuId: &resp.Menus[0].Id},
			{MenuId: m.blendMenu.ID, OrderMenuId: &resp.Menus[1].Id},
		},
	}).expect(http.StatusOK).decode(&updated)
	if len(updated.Payments) != 2 || len(updated.Payments[1].OrderMenuIds) != 1 || updated.Payments[1].OrderMenuIds[0] != resp.Menus[1].Id || updated.Payments[1].Amount != 850 {
		t.Fatalf("payments after update: %+v", updated.Payments)
	}
	api.nextBroadcast()

	// 注文を消すと支払いも消える
	api.do(http.MethodDelete, "/api/orders/"+resp.Id.String(), nil).expect(http.StatusOK)
	if n := api.count(&models.OrderPayment{}, "order_id = ?", resp.Id); n != 0 {
		t.Errorf("%d payments left", n)
	}
}

func TestCreateSplitOrderRejectsInvalidPayments(t *testing.T) {
	api := newTestAPI(t)
	m := api.seedMaster()
	lines := []models.MenuInfoCreate{menuLine(m.blendMenu), menuLine(m.iceMenu)}

	body := api.do(http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId: 1, BillingAmount: 850, MenuIds: lines,
		Payments: &[]models.OrderPaymentCreate{cashPayment(400, 400, 0), cashPayment(400, 400, 1)},
	}).expect(http.StatusBadRequest)
	if !strings.Contains(string(body.Body), "一致しません") {
		t.Errorf("error: %s", body.Body)
	}
	// Square の決済が見つからなければ 409（注文は作らない）
	api.do(http.MethodPost, "/api/orders", models.OrderCreateRequest{
		OrderId: 1, BillingAmount: 850, MenuIds: lines,
		Payments: &[]models.OrderPaymentCreate{cashPayment(400, 400, 0), squarePayment(450, uuid.New(), 1)},
	}).expect(http.StatusConflict)
	if n := api.count(&models.Order{}, ""); n != 0 {
		t.Errorf("%d orders created", n)
	}
	if n := api.count(&models.OrderPayment{}, ""); n != 0 {
		t.Errorf("%d payments created", n)
	}
	api.noBroadcast()
}
