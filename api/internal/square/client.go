// Package square は Square の REST API（Terminal / Payments / Refunds / Devices）を呼ぶ最小限のクライアント。
// Terminal API は checkout（決済画面）と action（決済手段を選ぶ画面）を使う。
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

// SelectOption は SELECT の画面に出すボタン 1 つ。
type SelectOption struct {
	ReferenceID string `json:"reference_id"`
	Title       string `json:"title"`
}

// SelectOptions は SELECT の画面の中身。選ばれたら selected_option に入る。
type SelectOptions struct {
	Title          string         `json:"title"`
	Body           string         `json:"body"`
	Options        []SelectOption `json:"options"`
	SelectedOption *SelectOption  `json:"selected_option,omitempty"`
}

// TerminalAction は Square の TerminalAction オブジェクトのうち使うフィールド。
// checkout と違って reference_id は無い。
type TerminalAction struct {
	ID               string         `json:"id,omitempty"`
	DeviceID         string         `json:"device_id,omitempty"`
	DeadlineDuration string         `json:"deadline_duration,omitempty"`
	Status           string         `json:"status,omitempty"`
	CancelReason     string         `json:"cancel_reason,omitempty"`
	Type             string         `json:"type,omitempty"`
	SelectOptions    *SelectOptions `json:"select_options,omitempty"`
	CreatedAt        string         `json:"created_at,omitempty"`
	UpdatedAt        string         `json:"updated_at,omitempty"`
}

type actionEnvelope struct {
	Action TerminalAction `json:"action"`
}

// CreateTerminalAction は端末に決済以外の画面（選択肢など）を出させる（POST /v2/terminals/actions）。
//
// idempotencyKey が同じなら、Square は同じ action を返す。
func (c *Client) CreateTerminalAction(ctx context.Context, idempotencyKey string, action TerminalAction) (*TerminalAction, error) {
	body := struct {
		IdempotencyKey string         `json:"idempotency_key"`
		Action         TerminalAction `json:"action"`
	}{IdempotencyKey: idempotencyKey, Action: action}
	var out actionEnvelope
	if err := c.do(ctx, http.MethodPost, "/v2/terminals/actions", body, &out); err != nil {
		return nil, err
	}
	return &out.Action, nil
}

// GetTerminalAction は action の現在の状態を取る（GET /v2/terminals/actions/{action_id}）。
func (c *Client) GetTerminalAction(ctx context.Context, actionID string) (*TerminalAction, error) {
	var out actionEnvelope
	if err := c.do(ctx, http.MethodGet, "/v2/terminals/actions/"+url.PathEscape(actionID), nil, &out); err != nil {
		return nil, err
	}
	return &out.Action, nil
}

// CancelTerminalAction は PENDING / IN_PROGRESS の action を取り消す
// （POST /v2/terminals/actions/{action_id}/cancel）。
func (c *Client) CancelTerminalAction(ctx context.Context, actionID string) (*TerminalAction, error) {
	var out actionEnvelope
	if err := c.do(ctx, http.MethodPost, "/v2/terminals/actions/"+url.PathEscape(actionID)+"/cancel", struct{}{}, &out); err != nil {
		return nil, err
	}
	return &out.Action, nil
}

// --------------------------------------------------
// Payments API
// --------------------------------------------------

// Payment は Square の Payment オブジェクトのうち使うフィールド。
//
// amount_money はチップを含まない額、total_money はチップを含む額。
// チップは受け付けない（tip_settings.allow_tipping の既定は false）ので、
// 依頼額と比べるのは amount_money。
//
// refunded_money は完了した返金の合計（返金が無ければ省かれる）、refund_ids は
// 処理中のものも含めた返金の ID。
type Payment struct {
	ID            string   `json:"id"`
	Status        string   `json:"status"`
	AmountMoney   Money    `json:"amount_money"`
	TotalMoney    Money    `json:"total_money"`
	RefundedMoney *Money   `json:"refunded_money,omitempty"`
	RefundIDs     []string `json:"refund_ids,omitempty"`
	SourceType    string   `json:"source_type"`
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
// Refunds API
// --------------------------------------------------

// PaymentRefund は Square の PaymentRefund オブジェクトのうち使うフィールド。
// status は PENDING / COMPLETED / REJECTED / FAILED。
type PaymentRefund struct {
	ID          string `json:"id"`
	Status      string `json:"status"`
	AmountMoney Money  `json:"amount_money"`
	PaymentID   string `json:"payment_id"`
	Reason      string `json:"reason,omitempty"`
}

type refundEnvelope struct {
	Refund PaymentRefund `json:"refund"`
}

// RefundPayment は決済を返金する（POST /v2/refunds）。
//
// Terminal API の返金（CreateTerminalRefund）はカナダの Interac 専用なので、日本の
// 端末で受けた決済もこちらで返す。返金先は元の決済手段（カード・電子マネー・QR）。
// idempotencyKey は 45 文字まで。同じキーの再送には、Square は同じ返金を返す。
func (c *Client) RefundPayment(ctx context.Context, idempotencyKey, paymentID string, amount Money, reason string) (*PaymentRefund, error) {
	body := struct {
		IdempotencyKey string `json:"idempotency_key"`
		PaymentID      string `json:"payment_id"`
		AmountMoney    Money  `json:"amount_money"`
		Reason         string `json:"reason,omitempty"`
	}{IdempotencyKey: idempotencyKey, PaymentID: paymentID, AmountMoney: amount, Reason: reason}
	var out refundEnvelope
	if err := c.do(ctx, http.MethodPost, "/v2/refunds", body, &out); err != nil {
		return nil, err
	}
	return &out.Refund, nil
}

// GetPaymentRefund は返金の現在の状態を取る（GET /v2/refunds/{refund_id}）。
func (c *Client) GetPaymentRefund(ctx context.Context, refundID string) (*PaymentRefund, error) {
	var out refundEnvelope
	if err := c.do(ctx, http.MethodGet, "/v2/refunds/"+url.PathEscape(refundID), nil, &out); err != nil {
		return nil, err
	}
	return &out.Refund, nil
}

// --------------------------------------------------
// Devices API（端末のペアリング）
// --------------------------------------------------

type DeviceCode struct {
	ID              string `json:"id,omitempty"`
	Name            string `json:"name,omitempty"`
	Code            string `json:"code,omitempty"`
	DeviceID        string `json:"device_id,omitempty"`
	ProductType     string `json:"product_type"`
	LocationID      string `json:"location_id,omitempty"`
	Status          string `json:"status,omitempty"`
	PairBy          string `json:"pair_by,omitempty"`
	CreatedAt       string `json:"created_at,omitempty"`
	StatusChangedAt string `json:"status_changed_at,omitempty"`
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

// ListDeviceCodesParams は ListDeviceCodes の絞り込み。空の項目は送らない。
type ListDeviceCodesParams struct {
	LocationID  string
	ProductType string
	Status      string
}

// ListDeviceCodes は API で発行したコードを、ページを辿って全て取る（GET /v2/devices/codes）。
func (c *Client) ListDeviceCodes(ctx context.Context, params ListDeviceCodesParams) ([]DeviceCode, error) {
	codes := []DeviceCode{}
	cursor := ""
	for {
		query := url.Values{}
		for key, value := range map[string]string{
			"location_id":  params.LocationID,
			"product_type": params.ProductType,
			"status":       params.Status,
			"cursor":       cursor,
		} {
			if value != "" {
				query.Set(key, value)
			}
		}
		path := "/v2/devices/codes"
		if encoded := query.Encode(); encoded != "" {
			path += "?" + encoded
		}
		var out struct {
			DeviceCodes []DeviceCode `json:"device_codes"`
			Cursor      string       `json:"cursor"`
		}
		if err := c.do(ctx, http.MethodGet, path, nil, &out); err != nil {
			return nil, err
		}
		codes = append(codes, out.DeviceCodes...)
		if out.Cursor == "" {
			return codes, nil
		}
		cursor = out.Cursor
	}
}
