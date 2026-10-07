package square

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type recordedRequest struct {
	method, path, auth, version, contentType string
	body                                     map[string]any
}

func newTestServer(t *testing.T, status int, response string) (*Client, *recordedRequest) {
	t.Helper()
	recorded := &recordedRequest{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		recorded.method = r.Method
		recorded.path = r.URL.Path
		recorded.auth = r.Header.Get("Authorization")
		recorded.version = r.Header.Get("Square-Version")
		recorded.contentType = r.Header.Get("Content-Type")
		raw, _ := io.ReadAll(r.Body)
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &recorded.body); err != nil {
				t.Errorf("request body is not JSON: %s", raw)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(server.Close)
	return NewClient(server.URL, "token-123"), recorded
}

func TestCreateTerminalCheckoutSendsExpectedRequest(t *testing.T) {
	client, recorded := newTestServer(t, http.StatusOK, `{"checkout":{"id":"08YceKh7B3ZqO","amount_money":{"amount":600,"currency":"JPY"},"reference_id":"ref","device_options":{"device_id":"dev"},"status":"PENDING","payment_type":"FELICA_ALL"}}`)
	checkout, err := client.CreateTerminalCheckout(context.Background(), "key-1", TerminalCheckout{
		AmountMoney:   Money{Amount: 600, Currency: "JPY"},
		ReferenceID:   "ref",
		Note:          "No.12",
		DeviceOptions: DeviceCheckoutOptions{DeviceID: "dev"},
		PaymentType:   "FELICA_ALL",
	})
	if err != nil {
		t.Fatal(err)
	}
	if checkout.ID != "08YceKh7B3ZqO" || checkout.Status != "PENDING" {
		t.Fatalf("unexpected checkout: %+v", checkout)
	}
	if recorded.method != http.MethodPost || recorded.path != "/v2/terminals/checkouts" {
		t.Fatalf("unexpected endpoint: %s %s", recorded.method, recorded.path)
	}
	if recorded.auth != "Bearer token-123" || recorded.version != APIVersion || recorded.contentType != "application/json" {
		t.Fatalf("unexpected headers: %+v", recorded)
	}
	if recorded.body["idempotency_key"] != "key-1" {
		t.Fatalf("idempotency_key missing: %v", recorded.body)
	}
	sent, _ := recorded.body["checkout"].(map[string]any)
	amount, _ := sent["amount_money"].(map[string]any)
	device, _ := sent["device_options"].(map[string]any)
	if amount["amount"] != float64(600) || amount["currency"] != "JPY" || device["device_id"] != "dev" ||
		sent["payment_type"] != "FELICA_ALL" || sent["reference_id"] != "ref" || sent["note"] != "No.12" {
		t.Fatalf("unexpected checkout body: %v", sent)
	}
	// 読み取り専用のフィールドは送らない。
	for _, field := range []string{"id", "status", "cancel_reason", "payment_ids", "created_at", "updated_at"} {
		if _, ok := sent[field]; ok {
			t.Fatalf("read-only field %q must not be sent: %v", field, sent)
		}
	}
}

func TestCancelTerminalCheckoutSendsEmptyObject(t *testing.T) {
	client, recorded := newTestServer(t, http.StatusOK, `{"checkout":{"id":"abc","status":"CANCELED","cancel_reason":"SELLER_CANCELED"}}`)
	checkout, err := client.CancelTerminalCheckout(context.Background(), "abc")
	if err != nil {
		t.Fatal(err)
	}
	if recorded.method != http.MethodPost || recorded.path != "/v2/terminals/checkouts/abc/cancel" {
		t.Fatalf("unexpected endpoint: %s %s", recorded.method, recorded.path)
	}
	if recorded.body == nil || len(recorded.body) != 0 {
		t.Fatalf("expected an empty JSON object, got %v", recorded.body)
	}
	if checkout.Status != "CANCELED" || checkout.CancelReason != "SELLER_CANCELED" {
		t.Fatalf("unexpected checkout: %+v", checkout)
	}
}

func TestGetPaymentReadsAmounts(t *testing.T) {
	client, recorded := newTestServer(t, http.StatusOK, `{"payment":{"id":"p1","status":"COMPLETED","amount_money":{"amount":600,"currency":"JPY"},"total_money":{"amount":600,"currency":"JPY"},"source_type":"WALLET"}}`)
	payment, err := client.GetPayment(context.Background(), "p1")
	if err != nil {
		t.Fatal(err)
	}
	if recorded.method != http.MethodGet || recorded.path != "/v2/payments/p1" {
		t.Fatalf("unexpected endpoint: %s %s", recorded.method, recorded.path)
	}
	if payment.Status != "COMPLETED" || payment.AmountMoney.Amount != 600 || payment.SourceType != "WALLET" {
		t.Fatalf("unexpected payment: %+v", payment)
	}
}

func TestErrorResponseIsReturnedAsAPIError(t *testing.T) {
	client, _ := newTestServer(t, http.StatusBadRequest, `{"errors":[{"category":"INVALID_REQUEST_ERROR","code":"NOT_FOUND","detail":"Device not found","field":"device_id"}]}`)
	_, err := client.GetTerminalCheckout(context.Background(), "abc")
	var apiErr *APIError
	if !errors.As(err, &apiErr) {
		t.Fatalf("expected APIError, got %v", err)
	}
	if apiErr.StatusCode != http.StatusBadRequest || len(apiErr.Errors) != 1 || apiErr.Errors[0].Code != "NOT_FOUND" {
		t.Fatalf("unexpected error: %+v", apiErr)
	}
	if !strings.Contains(err.Error(), "Device not found") {
		t.Fatalf("error message should include detail: %v", err)
	}
}

func TestBaseURLFor(t *testing.T) {
	cases := map[string]string{"production": ProductionBaseURL, "sandbox": SandboxBaseURL, "": SandboxBaseURL}
	for environment, want := range cases {
		got, err := BaseURLFor(environment)
		if err != nil || got != want {
			t.Fatalf("%q: got %q, %v", environment, got, err)
		}
	}
	if _, err := BaseURLFor("prod"); err == nil {
		t.Fatal("unknown environment must be rejected")
	}
}
