package square

import "testing"

// Square の「Verify and Validate an Event Notification」に載っている検証用の値。
const (
	officialSignatureKey = "asdf1234"
	officialURL          = "https://example.com/webhook"
	officialBody         = `{"hello":"world"}`
	officialSignature    = "2kRE5qRU2tR+tBGlDwMEw2avJ7QM4ikPYD/PJ3bd9Og="
)

func TestVerifySignatureMatchesOfficialExample(t *testing.T) {
	if !VerifySignature(officialSignatureKey, officialURL, []byte(officialBody), officialSignature) {
		t.Fatal("official example must verify")
	}
}

func TestVerifySignatureRejectsTampering(t *testing.T) {
	cases := map[string]struct {
		key, url, body, signature string
	}{
		"other body":      {officialSignatureKey, officialURL, `{"hello":"world!"}`, officialSignature},
		"other url":       {officialSignatureKey, "https://example.com/webhook/", officialBody, officialSignature},
		"other key":       {"other", officialURL, officialBody, officialSignature},
		"empty signature": {officialSignatureKey, officialURL, officialBody, ""},
		"empty key":       {"", officialURL, officialBody, officialSignature},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if VerifySignature(tc.key, tc.url, []byte(tc.body), tc.signature) {
				t.Fatal("must not verify")
			}
		})
	}
}

func TestParseWebhookEventReadsCheckout(t *testing.T) {
	// terminal.checkout.updated の公式の例（一部）。
	body := `{"merchant_id":"7NZR58EPNGNPC","type":"terminal.checkout.updated","event_id":"1c3ef831-670d-4f4c-b59c-f0bb2d2fc872","created_at":"2020-04-10T14:44:06.039Z","data":{"type":"checkout","id":"dhgENdnFOPXqO","object":{"checkout":{"amount_money":{"amount":111,"currency":"USD"},"created_at":"2020-04-10T14:43:55.262Z","deadline_duration":"PT5M","device_options":{"device_id":"907CS13101300122","skip_receipt_screen":false,"tip_settings":{"allow_tipping":false}},"id":"dhgENdnFOPXqO","note":"A simple note","payment_ids":["dgzrZTeIeVuOGwYgekoTHsPouaB"],"reference_id":"id72709","status":"COMPLETED","updated_at":"2020-04-10T14:44:06.039Z"}}}}`
	event, err := ParseWebhookEvent([]byte(body))
	if err != nil {
		t.Fatal(err)
	}
	checkout := event.Data.Object.Checkout
	if event.Type != "terminal.checkout.updated" || checkout == nil {
		t.Fatalf("unexpected event: %+v", event)
	}
	if checkout.ID != "dhgENdnFOPXqO" || checkout.Status != "COMPLETED" || checkout.ReferenceID != "id72709" ||
		len(checkout.PaymentIDs) != 1 || checkout.PaymentIDs[0] != "dgzrZTeIeVuOGwYgekoTHsPouaB" ||
		checkout.AmountMoney.Amount != 111 || checkout.DeviceOptions.DeviceID != "907CS13101300122" {
		t.Fatalf("unexpected checkout: %+v", checkout)
	}
}

func TestParseWebhookEventWithoutCheckout(t *testing.T) {
	event, err := ParseWebhookEvent([]byte(`{"type":"device.code.paired","data":{"object":{"device_code":{}}}}`))
	if err != nil {
		t.Fatal(err)
	}
	if event.Data.Object.Checkout != nil {
		t.Fatal("checkout must be nil for other events")
	}
}
