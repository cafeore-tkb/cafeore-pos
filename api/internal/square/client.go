// Package square は Square の REST API（Terminal / Payments / Devices）を呼ぶ最小限のクライアント。
//
// 公式 SDK は使わず net/http で呼ぶ。使う API が少なく、レスポンスも必要な
// フィールドだけ読めば足りるため。
package square

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// APIVersion は Square-Version ヘッダーに入れる API のバージョン。
//
// 固定しておかないと、Developer Console 側の既定バージョンが変わったときに
// レスポンスの形が黙って変わる。上げるときはリリースノートを確認すること。
const APIVersion = "2026-09-16"

const (
	ProductionBaseURL = "https://connect.squareup.com"
	SandboxBaseURL    = "https://connect.squareupsandbox.com"
)

// BaseURLFor は SQUARE_ENVIRONMENT の値から接続先を決める。
func BaseURLFor(environment string) (string, error) {
	switch environment {
	case "production":
		return ProductionBaseURL, nil
	case "", "sandbox":
		return SandboxBaseURL, nil
	default:
		return "", fmt.Errorf("unknown SQUARE_ENVIRONMENT %q (production か sandbox)", environment)
	}
}

type Client struct {
	baseURL     string
	accessToken string
	httpClient  *http.Client
}

func NewClient(baseURL, accessToken string) *Client {
	return &Client{
		baseURL:     strings.TrimRight(baseURL, "/"),
		accessToken: accessToken,
		httpClient:  &http.Client{Timeout: 15 * time.Second},
	}
}

// Error は Square が返す errors[] の1件。
type Error struct {
	Category string `json:"category"`
	Code     string `json:"code"`
	Detail   string `json:"detail,omitempty"`
	Field    string `json:"field,omitempty"`
}

// APIError は Square が 2xx 以外を返したときのエラー。
type APIError struct {
	StatusCode int
	Errors     []Error
}

func (e *APIError) Error() string {
	if len(e.Errors) == 0 {
		return fmt.Sprintf("square: HTTP %d", e.StatusCode)
	}
	parts := make([]string, 0, len(e.Errors))
	for _, item := range e.Errors {
		part := item.Code
		if item.Detail != "" {
			part += ": " + item.Detail
		}
		if item.Field != "" {
			part += " (" + item.Field + ")"
		}
		parts = append(parts, part)
	}
	return fmt.Sprintf("square: HTTP %d: %s", e.StatusCode, strings.Join(parts, "; "))
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(encoded)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reader)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+c.accessToken)
	req.Header.Set("Square-Version", APIVersion)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		apiErr := &APIError{StatusCode: resp.StatusCode}
		var envelope struct {
			Errors []Error `json:"errors"`
		}
		if json.Unmarshal(raw, &envelope) == nil {
			apiErr.Errors = envelope.Errors
		}
		return apiErr
	}
	if out == nil {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// --------------------------------------------------
// Terminal API
// --------------------------------------------------

type Money struct {
	Amount   int64  `json:"amount"`
	Currency string `json:"currency"`
}

type TipSettings struct {
	AllowTipping bool `json:"allow_tipping"`
}

type DeviceCheckoutOptions struct {
	DeviceID          string       `json:"device_id"`
	SkipReceiptScreen *bool        `json:"skip_receipt_screen,omitempty"`
	TipSettings       *TipSettings `json:"tip_settings,omitempty"`
}

// TerminalCheckout は Square の TerminalCheckout オブジェクトのうち使うフィールド。
type TerminalCheckout struct {
	ID            string                `json:"id,omitempty"`
	AmountMoney   Money                 `json:"amount_money"`
	ReferenceID   string                `json:"reference_id,omitempty"`
	Note          string                `json:"note,omitempty"`
	DeviceOptions DeviceCheckoutOptions `json:"device_options"`
	PaymentType   string                `json:"payment_type,omitempty"`
	Status        string                `json:"status,omitempty"`
	CancelReason  string                `json:"cancel_reason,omitempty"`
	PaymentIDs    []string              `json:"payment_ids,omitempty"`
	CreatedAt     string                `json:"created_at,omitempty"`
	UpdatedAt     string                `json:"updated_at,omitempty"`
}

type checkoutEnvelope struct {
	Checkout TerminalCheckout `json:"checkout"`
}

// CreateTerminalCheckout は端末に決済画面を出させる（POST /v2/terminals/checkouts）。
//
// idempotencyKey が同じなら、Square は同じ checkout を返す。応答が失われて
// 再送したときに二重に決済画面が出ないよう、呼び出し側で固定の値を渡すこと。
func (c *Client) CreateTerminalCheckout(ctx context.Context, idempotencyKey string, checkout TerminalCheckout) (*TerminalCheckout, error) {
	body := struct {
		IdempotencyKey string           `json:"idempotency_key"`
		Checkout       TerminalCheckout `json:"checkout"`
	}{IdempotencyKey: idempotencyKey, Checkout: checkout}
	var out checkoutEnvelope
	if err := c.do(ctx, http.MethodPost, "/v2/terminals/checkouts", body, &out); err != nil {
		return nil, err
	}
	return &out.Checkout, nil
}

// GetTerminalCheckout は checkout の現在の状態を取る（GET /v2/terminals/checkouts/{checkout_id}）。
func (c *Client) GetTerminalCheckout(ctx context.Context, checkoutID string) (*TerminalCheckout, error) {
	var out checkoutEnvelope
	if err := c.do(ctx, http.MethodGet, "/v2/terminals/checkouts/"+url.PathEscape(checkoutID), nil, &out); err != nil {
		return nil, err
	}
	return &out.Checkout, nil
}

// CancelTerminalCheckout は PENDING / IN_PROGRESS の checkout を取り消す
// （POST /v2/terminals/checkouts/{checkout_id}/cancel）。
func (c *Client) CancelTerminalCheckout(ctx context.Context, checkoutID string) (*TerminalCheckout, error) {
	var out checkoutEnvelope
	// 公式の例に合わせて空のオブジェクトを送る。
	if err := c.do(ctx, http.MethodPost, "/v2/terminals/checkouts/"+url.PathEscape(checkoutID)+"/cancel", struct{}{}, &out); err != nil {
		return nil, err
	}
	return &out.Checkout, nil
}

// --------------------------------------------------
// Payments API
// --------------------------------------------------

// Payment は Square の Payment オブジェクトのうち使うフィールド。
//
// amount_money はチップを含まない額、total_money はチップを含む額。
// チップは受け付けない（tip_settings.allow_tipping の既定は false）ので、
// 依頼額と比べるのは amount_money。
type Payment struct {
	ID          string `json:"id"`
	Status      string `json:"status"`
	AmountMoney Money  `json:"amount_money"`
	TotalMoney  Money  `json:"total_money"`
	SourceType  string `json:"source_type"`
}

// GetPayment は決済の詳細を取る（GET /v2/payments/{payment_id}）。
func (c *Client) GetPayment(ctx context.Context, paymentID string) (*Payment, error) {
	var out struct {
		Payment Payment `json:"payment"`
	}
	if err := c.do(ctx, http.MethodGet, "/v2/payments/"+url.PathEscape(paymentID), nil, &out); err != nil {
		return nil, err
	}
	return &out.Payment, nil
}

// --------------------------------------------------
// Devices API（端末のペアリング）
// --------------------------------------------------

type DeviceCode struct {
	ID          string `json:"id,omitempty"`
	Name        string `json:"name,omitempty"`
	Code        string `json:"code,omitempty"`
	DeviceID    string `json:"device_id,omitempty"`
	ProductType string `json:"product_type"`
	LocationID  string `json:"location_id,omitempty"`
	Status      string `json:"status,omitempty"`
	PairBy      string `json:"pair_by,omitempty"`
}

type deviceCodeEnvelope struct {
	DeviceCode DeviceCode `json:"device_code"`
}

// CreateDeviceCode は端末のサインインに使うコードを発行する（POST /v2/devices/codes）。
func (c *Client) CreateDeviceCode(ctx context.Context, idempotencyKey string, code DeviceCode) (*DeviceCode, error) {
	body := struct {
		IdempotencyKey string     `json:"idempotency_key"`
		DeviceCode     DeviceCode `json:"device_code"`
	}{IdempotencyKey: idempotencyKey, DeviceCode: code}
	var out deviceCodeEnvelope
	if err := c.do(ctx, http.MethodPost, "/v2/devices/codes", body, &out); err != nil {
		return nil, err
	}
	return &out.DeviceCode, nil
}

// GetDeviceCode はコードのペアリング状態と device_id を取る（GET /v2/devices/codes/{id}）。
func (c *Client) GetDeviceCode(ctx context.Context, id string) (*DeviceCode, error) {
	var out deviceCodeEnvelope
	if err := c.do(ctx, http.MethodGet, "/v2/devices/codes/"+url.PathEscape(id), nil, &out); err != nil {
		return nil, err
	}
	return &out.DeviceCode, nil
}
