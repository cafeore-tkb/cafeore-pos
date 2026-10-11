package square

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
)

// SignatureHeader は Webhook の署名が入るヘッダー。
const SignatureHeader = "x-square-hmacsha256-signature"

// VerifySignature は Webhook の署名を確かめる。
//
// 署名は「Developer Console に登録した通知 URL」と「リクエストボディそのまま」を
// 連結した文字列の HMAC-SHA256 を Base64 にしたもの。URL は登録した文字列と
// 1 文字でも違うと一致しないので、Cloud Run が受けた URL から組み立てず、
// 設定値（SQUARE_WEBHOOK_URL）をそのまま使う。
func VerifySignature(signatureKey, notificationURL string, body []byte, signature string) bool {
	if signatureKey == "" || signature == "" {
		return false
	}
	expected := Sign(signatureKey, notificationURL, body)
	return hmac.Equal([]byte(expected), []byte(signature))
}

// Sign は Square と同じ方法で署名を作る（テストや手元での再現に使う）。
func Sign(signatureKey, notificationURL string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(signatureKey))
	mac.Write([]byte(notificationURL))
	mac.Write(body)
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// WebhookEvent は Webhook の本文のうち使うフィールド。
type WebhookEvent struct {
	MerchantID string `json:"merchant_id"`
	Type       string `json:"type"`
	EventID    string `json:"event_id"`
	Data       struct {
		Type   string `json:"type"`
		ID     string `json:"id"`
		Object struct {
			Checkout *TerminalCheckout `json:"checkout"`
		} `json:"object"`
	} `json:"data"`
}

// ParseWebhookEvent は Webhook の本文を読む。
func ParseWebhookEvent(body []byte) (*WebhookEvent, error) {
	var event WebhookEvent
	if err := json.Unmarshal(body, &event); err != nil {
		return nil, err
	}
	return &event, nil
}
