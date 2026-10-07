package handlers

import (
	"strings"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/square"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func ptr[T any](value T) *T { return &value }

var squareTestNow = time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)

func squareRecord(status string, mutate func(*models.SquareCheckout)) *models.SquareCheckout {
	record := &models.SquareCheckout{
		ID:          uuid.New(),
		CheckoutID:  ptr("chk"),
		Amount:      600,
		PaymentType: string(models.CARDPRESENT),
		Status:      status,
		PaymentIDs:  []string{},
		CreatedAt:   squareTestNow.Add(-time.Minute),
	}
	if mutate != nil {
		mutate(record)
	}
	return record
}

func TestSquareCheckoutOutcome(t *testing.T) {
	cases := map[string]struct {
		record *models.SquareCheckout
		want   models.SquareCheckoutOutcome
	}{
		"pending":          {squareRecord(squareStatusPending, nil), models.Pending},
		"in progress":      {squareRecord(squareStatusInProgress, nil), models.Pending},
		"cancel requested": {squareRecord(squareStatusCancelRequested, nil), models.Pending},
		"unknown status":   {squareRecord("SOMETHING_NEW", nil), models.Pending},
		"completed without verified amount": {
			squareRecord(squareStatusCompleted, nil), models.Pending,
		},
		"completed and amount matches": {
			squareRecord(squareStatusCompleted, func(r *models.SquareCheckout) { r.PaidAmount = ptr(600) }), models.Paid,
		},
		"completed but amount differs": {
			squareRecord(squareStatusCompleted, func(r *models.SquareCheckout) { r.PaidAmount = ptr(500) }), models.Attention,
		},
		"canceled by buyer": {
			squareRecord(squareStatusCanceled, func(r *models.SquareCheckout) { r.CancelReason = ptr("BUYER_CANCELED") }), models.Failed,
		},
		"canceled by seller": {
			squareRecord(squareStatusCanceled, func(r *models.SquareCheckout) { r.CancelReason = ptr("SELLER_CANCELED") }), models.Failed,
		},
		// 期限ちょうどの支払いは CANCELED の後に COMPLETED になりうるので、猶予の間は待つ。
		"timed out within grace": {
			squareRecord(squareStatusCanceled, func(r *models.SquareCheckout) {
				r.CancelReason = ptr(squareCancelReasonTimedOut)
				r.CreatedAt = squareTestNow.Add(-squareCheckoutDeadline)
			}), models.Pending,
		},
		"timed out after grace": {
			squareRecord(squareStatusCanceled, func(r *models.SquareCheckout) {
				r.CancelReason = ptr(squareCancelReasonTimedOut)
				r.CreatedAt = squareTestNow.Add(-(squareCheckoutDeadline + squareTimeoutGrace + time.Second))
			}), models.Failed,
		},
		"error": {squareRecord(squareStatusError, nil), models.Failed},
		"creating just now": {
			squareRecord(squareStatusCreating, func(r *models.SquareCheckout) { r.CreatedAt = squareTestNow }), models.Pending,
		},
		"creating stale": {
			squareRecord(squareStatusCreating, func(r *models.SquareCheckout) {
				r.CreatedAt = squareTestNow.Add(-(squareCreatingStale + time.Second))
			}), models.Failed,
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := squareCheckoutOutcome(tc.record, squareTestNow); got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestSquareCheckoutNeedsRefresh(t *testing.T) {
	if squareCheckoutNeedsRefresh(squareRecord(squareStatusPending, func(r *models.SquareCheckout) { r.CheckoutID = nil }), squareTestNow) {
		t.Fatal("a checkout unknown to Square cannot be refreshed")
	}
	if !squareCheckoutNeedsRefresh(squareRecord(squareStatusInProgress, nil), squareTestNow) {
		t.Fatal("in-progress checkout must be refreshed")
	}
	if !squareCheckoutNeedsRefresh(squareRecord(squareStatusCompleted, nil), squareTestNow) {
		t.Fatal("completed checkout without verified amount must be refreshed")
	}
	if squareCheckoutNeedsRefresh(squareRecord(squareStatusCompleted, func(r *models.SquareCheckout) { r.PaidAmount = ptr(600) }), squareTestNow) {
		t.Fatal("verified checkout is final")
	}
	if squareCheckoutNeedsRefresh(squareRecord(squareStatusCanceled, func(r *models.SquareCheckout) { r.CancelReason = ptr("BUYER_CANCELED") }), squareTestNow) {
		t.Fatal("canceled checkout is final")
	}
	timedOut := squareRecord(squareStatusCanceled, func(r *models.SquareCheckout) {
		r.CancelReason = ptr(squareCancelReasonTimedOut)
		r.CreatedAt = squareTestNow.Add(-squareCheckoutDeadline)
	})
	if !squareCheckoutNeedsRefresh(timedOut, squareTestNow) {
		t.Fatal("timed-out checkout within grace must be refreshed")
	}
}

func TestApplySquareCheckout(t *testing.T) {
	record := squareRecord(squareStatusCreating, func(r *models.SquareCheckout) { r.CheckoutID = nil })
	applySquareCheckout(record, &square.TerminalCheckout{ID: "chk-1", Status: squareStatusInProgress})
	if record.CheckoutID == nil || *record.CheckoutID != "chk-1" || record.Status != squareStatusInProgress {
		t.Fatalf("unexpected record: %+v", record)
	}

	applySquareCheckout(record, &square.TerminalCheckout{ID: "chk-1", Status: squareStatusCompleted, PaymentIDs: []string{"p1"}})
	if record.Status != squareStatusCompleted || len(record.PaymentIDs) != 1 {
		t.Fatalf("completion not applied: %+v", record)
	}

	// 届く順序が前後しても、完了を取り消しで上書きしない。
	applySquareCheckout(record, &square.TerminalCheckout{ID: "chk-1", Status: squareStatusCanceled, CancelReason: squareCancelReasonTimedOut})
	if record.Status != squareStatusCompleted || record.CancelReason != nil {
		t.Fatalf("completed checkout must not regress: %+v", record)
	}
}

func TestSquarePaidAmount(t *testing.T) {
	paid, err := squarePaidAmount([]*square.Payment{
		{ID: "a", Status: "COMPLETED", AmountMoney: square.Money{Amount: 400, Currency: "JPY"}},
		{ID: "b", Status: "COMPLETED", AmountMoney: square.Money{Amount: 200, Currency: "JPY"}},
	})
	if err != nil || paid != 600 {
		t.Fatalf("got %d, %v", paid, err)
	}
	cases := map[string][]*square.Payment{
		"no payments":    nil,
		"not completed":  {{ID: "a", Status: "APPROVED", AmountMoney: square.Money{Amount: 600, Currency: "JPY"}}},
		"other currency": {{ID: "a", Status: "COMPLETED", AmountMoney: square.Money{Amount: 600, Currency: "USD"}}},
	}
	for name, payments := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := squarePaidAmount(payments); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestValidateSquareCheckoutForOrder(t *testing.T) {
	paid := func(mutate func(*models.SquareCheckout)) *models.SquareCheckout {
		return squareRecord(squareStatusCompleted, func(r *models.SquareCheckout) {
			r.PaidAmount = ptr(600)
			if mutate != nil {
				mutate(r)
			}
		})
	}
	if err := validateSquareCheckoutForOrder(paid(nil), 600, squareTestNow); err != nil {
		t.Fatalf("paid checkout must be usable: %v", err)
	}
	cases := map[string]struct {
		record  *models.SquareCheckout
		billing int
	}{
		"already linked":      {paid(func(r *models.SquareCheckout) { r.OrderID = ptr(uuid.New()) }), 600},
		"billing differs":     {paid(nil), 700},
		"not verified yet":    {squareRecord(squareStatusCompleted, nil), 600},
		"paid amount differs": {paid(func(r *models.SquareCheckout) { r.PaidAmount = ptr(500) }), 600},
		"in progress":         {squareRecord(squareStatusInProgress, nil), 600},
		"canceled":            {squareRecord(squareStatusCanceled, func(r *models.SquareCheckout) { r.CancelReason = ptr("BUYER_CANCELED") }), 600},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if err := validateSquareCheckoutForOrder(tc.record, tc.billing, squareTestNow); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestValidateSquareCheckoutRequest(t *testing.T) {
	valid := models.SquareCheckoutCreateRequest{IdempotencyKey: uuid.NewString(), Amount: 600, PaymentType: models.QRCODE}
	if err := validateSquareCheckoutRequest(valid); err != nil {
		t.Fatal(err)
	}
	cases := map[string]func(*models.SquareCheckoutCreateRequest){
		"empty key":          func(r *models.SquareCheckoutCreateRequest) { r.IdempotencyKey = "" },
		"too long key":       func(r *models.SquareCheckoutCreateRequest) { r.IdempotencyKey = strings.Repeat("a", 65) },
		"zero amount":        func(r *models.SquareCheckoutCreateRequest) { r.Amount = 0 },
		"negative amount":    func(r *models.SquareCheckoutCreateRequest) { r.Amount = -100 },
		"unsupported type":   func(r *models.SquareCheckoutCreateRequest) { r.PaymentType = "PAYPAY" },
		"manual card entry":  func(r *models.SquareCheckoutCreateRequest) { r.PaymentType = "MANUAL_CARD_ENTRY" },
		"empty payment type": func(r *models.SquareCheckoutCreateRequest) { r.PaymentType = "" },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			req := valid
			mutate(&req)
			if err := validateSquareCheckoutRequest(req); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestBuildTerminalCheckout(t *testing.T) {
	record := squareRecord(squareStatusCreating, func(r *models.SquareCheckout) {
		r.DeviceID = "device-1"
		r.PaymentType = string(models.FELICAALL)
		r.OrderNumber = ptr(42)
	})
	checkout := buildTerminalCheckout(record)
	if checkout.AmountMoney.Amount != 600 || checkout.AmountMoney.Currency != "JPY" ||
		checkout.DeviceOptions.DeviceID != "device-1" || checkout.PaymentType != "FELICA_ALL" ||
		checkout.Note != "No.42" || checkout.ReferenceID != record.ID.String() {
		t.Fatalf("unexpected checkout: %+v", checkout)
	}
	// reference_id は最大 40 文字。UUID（36 文字）なら収まる。
	if len(checkout.ReferenceID) > 40 {
		t.Fatalf("reference_id too long: %q", checkout.ReferenceID)
	}
}

func TestSquareCheckoutIDForOrder(t *testing.T) {
	checkoutID := openapi_types.UUID(uuid.New())
	squareMethod := models.Square
	cash := models.Cash
	unknown := models.PaymentMethod("card")

	if id, err := squareCheckoutIDForOrder(models.OrderCreateRequest{}); err != nil || id != nil {
		t.Fatalf("default must be cash: %v, %v", id, err)
	}
	if id, err := squareCheckoutIDForOrder(models.OrderCreateRequest{PaymentMethod: &squareMethod, SquareCheckoutId: &checkoutID}); err != nil || id == nil || *id != uuid.UUID(checkoutID) {
		t.Fatalf("square with checkout: %v, %v", id, err)
	}
	invalid := map[string]models.OrderCreateRequest{
		"square without checkout": {PaymentMethod: &squareMethod},
		"cash with checkout":      {PaymentMethod: &cash, SquareCheckoutId: &checkoutID},
		"unknown method":          {PaymentMethod: &unknown},
	}
	for name, req := range invalid {
		t.Run(name, func(t *testing.T) {
			if _, err := squareCheckoutIDForOrder(req); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestOrderResponsePaymentMethod(t *testing.T) {
	if got := toOrderResponse(&models.Order{PaymentMethod: "square"}).PaymentMethod; got != models.Square {
		t.Fatalf("got %s", got)
	}
	// 列を足す前の行は空文字。現金として返す。
	if got := toOrderResponse(&models.Order{}).PaymentMethod; got != models.Cash {
		t.Fatalf("got %s", got)
	}
}
