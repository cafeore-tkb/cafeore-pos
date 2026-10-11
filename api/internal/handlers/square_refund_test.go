package handlers

import (
	"errors"
	"net/http"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/square"
	"github.com/google/uuid"
)

// paidRecord は支払いを確かめた決済依頼を作る。
func paidRecord(mutate func(*models.SquareCheckout)) *models.SquareCheckout {
	return squareRecord(squareStatusCompleted, func(r *models.SquareCheckout) {
		r.PaidAmount = ptr(600)
		r.PaymentIDs = []string{"p1"}
		if mutate != nil {
			mutate(r)
		}
	})
}

func withRefund(status string, mutate func(*models.SquareCheckout)) *models.SquareCheckout {
	return paidRecord(func(r *models.SquareCheckout) {
		r.RefundStatus = ptr(status)
		r.RefundRequestedAt = ptr(squareTestNow.Add(-time.Second))
		if mutate != nil {
			mutate(r)
		}
	})
}

func TestDecideSquareRefund(t *testing.T) {
	cases := map[string]struct {
		record *models.SquareCheckout
		want   squareRefundAction
	}{
		"not refunded yet":  {paidRecord(nil), squareRefundStart},
		"previously failed": {withRefund(squareRefundFailed, nil), squareRefundStart},
		"no response from Square": {withRefund(squareRefundRequesting, func(r *models.SquareCheckout) {
			r.RefundError = ptr("timeout")
		}), squareRefundResume},
		"server died while requesting": {withRefund(squareRefundRequesting, func(r *models.SquareCheckout) {
			r.RefundRequestedAt = ptr(squareTestNow.Add(-(squareRefundRequestingStale + time.Second)))
		}), squareRefundResume},
		"pending":   {withRefund(squareRefundPending, nil), squareRefundAccepted},
		"completed": {withRefund(squareRefundCompleted, nil), squareRefundAccepted},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := decideSquareRefund(tc.record, squareTestNow)
			if err != nil || got != tc.want {
				t.Fatalf("got %v, %v; want %v", got, err, tc.want)
			}
		})
	}

	conflicts := map[string]*models.SquareCheckout{
		"requesting right now": withRefund(squareRefundRequesting, nil),
		"not verified yet":     squareRecord(squareStatusCompleted, nil),
		"no payments":          paidRecord(func(r *models.SquareCheckout) { r.PaymentIDs = []string{} }),
		"in progress":          squareRecord(squareStatusInProgress, nil),
		"canceled":             squareRecord(squareStatusCanceled, nil),
	}
	for name, record := range conflicts {
		t.Run(name, func(t *testing.T) {
			_, err := decideSquareRefund(record, squareTestNow)
			if !errors.As(err, new(*squareRefundConflict)) {
				t.Fatalf("expected a conflict, got %v", err)
			}
		})
	}
}

func TestSquareRefundOutcome(t *testing.T) {
	cases := map[string]struct {
		record *models.SquareCheckout
		want   models.SquareRefundStatus
	}{
		"none":       {paidRecord(nil), models.RefundNone},
		"requesting": {withRefund(squareRefundRequesting, nil), models.RefundPending},
		"no response": {withRefund(squareRefundRequesting, func(r *models.SquareCheckout) {
			r.RefundError = ptr("timeout")
		}), models.RefundFailed},
		"pending":       {withRefund(squareRefundPending, nil), models.RefundPending},
		"completed":     {withRefund(squareRefundCompleted, nil), models.RefundRefunded},
		"failed":        {withRefund(squareRefundFailed, nil), models.RefundFailed},
		"unknown value": {withRefund("SOMETHING_NEW", nil), models.RefundPending},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := squareRefundOutcome(tc.record, squareTestNow); got != tc.want {
				t.Fatalf("got %s, want %s", got, tc.want)
			}
		})
	}
}

func TestSquareRefundStatusOf(t *testing.T) {
	cases := map[string]struct {
		statuses   []string
		want       string
		hasMessage bool
	}{
		"nothing left to refund": {nil, squareRefundCompleted, false},
		"all completed":          {[]string{"COMPLETED", "COMPLETED"}, squareRefundCompleted, false},
		"one pending":            {[]string{"COMPLETED", "PENDING"}, squareRefundPending, false},
		"one rejected":           {[]string{"PENDING", "REJECTED"}, squareRefundFailed, true},
		"failed":                 {[]string{"FAILED"}, squareRefundFailed, true},
		"unknown status":         {[]string{"SOMETHING_NEW"}, squareRefundPending, false},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			got, message := squareRefundStatusOf(tc.statuses)
			if got != tc.want || (message != nil) != tc.hasMessage {
				t.Fatalf("got %s, %v", got, message)
			}
		})
	}
}

func TestSquareRefundUncertain(t *testing.T) {
	cases := map[string]struct {
		err  error
		want bool
	}{
		"network":      {errors.New("connection reset"), true},
		"server error": {&square.APIError{StatusCode: http.StatusInternalServerError}, true},
		"rate limited": {&square.APIError{StatusCode: http.StatusTooManyRequests}, true},
		"rejected":     {&square.APIError{StatusCode: http.StatusBadRequest}, false},
		"forbidden":    {&square.APIError{StatusCode: http.StatusForbidden}, false},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := squareRefundUncertain(tc.err); got != tc.want {
				t.Fatalf("got %v", got)
			}
		})
	}
}

func TestSquareRefundIdempotencyKey(t *testing.T) {
	refundKey := uuid.New()
	key := squareRefundIdempotencyKey(refundKey, "p1")
	// RefundPayment の idempotency_key は最大 45 文字。
	if len(key) > 45 {
		t.Fatalf("too long: %q", key)
	}
	// 頼み直しで同じキーになり、決済ごと・依頼ごとには別のキーになる。
	if key != squareRefundIdempotencyKey(refundKey, "p1") ||
		key == squareRefundIdempotencyKey(refundKey, "p2") ||
		key == squareRefundIdempotencyKey(uuid.New(), "p1") {
		t.Fatal("unexpected key derivation")
	}
}

func TestValidateSquareCheckoutForOrderAfterRefund(t *testing.T) {
	// 返金が失敗した決済はお金が手元にあるので、注文に使える。
	if err := validateSquareCheckoutForOrder(withRefund(squareRefundFailed, nil), 600, squareTestNow); err != nil {
		t.Fatalf("failed refund must keep the checkout usable: %v", err)
	}
	for _, status := range []string{squareRefundRequesting, squareRefundPending, squareRefundCompleted} {
		t.Run(status, func(t *testing.T) {
			if err := validateSquareCheckoutForOrder(withRefund(status, nil), 600, squareTestNow); err == nil {
				t.Fatal("expected error")
			}
		})
	}
}

func TestSquareCheckoutResponseIncludesRefund(t *testing.T) {
	response := toSquareCheckoutResponse(withRefund(squareRefundFailed, func(r *models.SquareCheckout) {
		r.RefundError = ptr("REFUND_DECLINED")
	}), squareTestNow)
	if response.RefundStatus != models.RefundFailed || response.RefundError == nil || *response.RefundError != "REFUND_DECLINED" {
		t.Fatalf("unexpected response: %+v", response)
	}
}
