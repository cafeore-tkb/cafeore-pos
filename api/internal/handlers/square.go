// api/internal/handlers/square.go
package handlers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/square"
)

// Square の TerminalCheckout.status。CREATING と ERROR はこちらで使う独自の値。
const (
	squareStatusCreating        = "CREATING"
	squareStatusError           = "ERROR"
	squareStatusPending         = "PENDING"
	squareStatusInProgress      = "IN_PROGRESS"
	squareStatusCancelRequested = "CANCEL_REQUESTED"
	squareStatusCanceled        = "CANCELED"
	squareStatusCompleted       = "COMPLETED"

	squareCancelReasonTimedOut = "TIMED_OUT"
	squarePaymentCompleted     = "COMPLETED"
)

const (
	// Square は作成から 5 分で checkout を自動で取り消す。
	squareCheckoutDeadline = 5 * time.Minute
	// 期限ちょうどに端末で支払いが終わると、CANCELED になった後で COMPLETED に
	// 変わることがある（Take One-Off Payments に記載）。TIMED_OUT のときは
	// この猶予が過ぎるまで「未確定」として扱い、現金での取り直しを止める。
	squareTimeoutGrace = time.Minute
	// CREATING のまま残っている行（Square を呼ぶ前後でサーバーが落ちた）を
	// 失敗とみなすまでの時間。
	squareCreatingStale = time.Minute
)

// squareAPI は SquareHandler が使う Square の API。テストで差し替える。
type squareAPI interface {
	CreateTerminalCheckout(ctx context.Context, idempotencyKey string, checkout square.TerminalCheckout) (*square.TerminalCheckout, error)
	GetTerminalCheckout(ctx context.Context, checkoutID string) (*square.TerminalCheckout, error)
	CancelTerminalCheckout(ctx context.Context, checkoutID string) (*square.TerminalCheckout, error)
	GetPayment(ctx context.Context, paymentID string) (*square.Payment, error)
}

// SquareConfig は環境変数から読む Square 連携の設定。
type SquareConfig struct {
	AccessToken         string // SQUARE_ACCESS_TOKEN
	Environment         string // SQUARE_ENVIRONMENT（production / sandbox）
	DeviceID            string // SQUARE_DEVICE_ID（ペアリングで得た端末の ID）
	WebhookSignatureKey string // SQUARE_WEBHOOK_SIGNATURE_KEY
	WebhookURL          string // SQUARE_WEBHOOK_URL（Developer Console に登録した通知 URL そのまま）
}

type SquareHandler struct {
	db                  *gorm.DB
	client              squareAPI // 未設定なら nil
	environment         string
	deviceID            string
	webhookSignatureKey string
	webhookURL          string
	now                 func() time.Time
}

// NewSquareHandler は設定から SquareHandler を作る。
//
// アクセストークンか端末 ID が無ければ連携を無効にする（エンドポイントは 503）。
// 環境の指定が不正なときだけエラーを返す。本番のつもりで sandbox に向けて
// しまうと、決済したつもりで売上が立たないため、黙って既定値にしない。
func NewSquareHandler(db *gorm.DB, config SquareConfig) (*SquareHandler, error) {
	baseURL, err := square.BaseURLFor(config.Environment)
	if err != nil {
		return nil, err
	}
	environment := config.Environment
	if environment == "" {
		environment = "sandbox"
	}
	handler := &SquareHandler{
		db:                  db,
		environment:         environment,
		deviceID:            config.DeviceID,
		webhookSignatureKey: config.WebhookSignatureKey,
		webhookURL:          config.WebhookURL,
		now:                 time.Now,
	}
	if config.AccessToken != "" && config.DeviceID != "" {
		handler.client = square.NewClient(baseURL, config.AccessToken)
	}
	return handler, nil
}

func (h *SquareHandler) enabled() bool {
	return h.client != nil
}

func (h *SquareHandler) webhookEnabled() bool {
	return h.webhookSignatureKey != "" && h.webhookURL != ""
}

// --------------------------------------------------
// 状態の判定（純粋な関数）
// --------------------------------------------------

// squareCheckoutOutcome はレジが次にすべきことを決める。
func squareCheckoutOutcome(checkout *models.SquareCheckout, now time.Time) models.SquareCheckoutOutcome {
	switch checkout.Status {
	case squareStatusCompleted:
		if checkout.PaidAmount == nil {
			// 受取額をまだ確かめられていない。次の問い合わせで確かめる。
			return models.Pending
		}
		if *checkout.PaidAmount != checkout.Amount {
			return models.Attention
		}
		return models.Paid
	case squareStatusCanceled:
		if checkout.CancelReason != nil && *checkout.CancelReason == squareCancelReasonTimedOut &&
			now.Before(checkout.CreatedAt.Add(squareCheckoutDeadline+squareTimeoutGrace)) {
			return models.Pending
		}
		return models.Failed
	case squareStatusError:
		return models.Failed
	case squareStatusCreating:
		if now.After(checkout.CreatedAt.Add(squareCreatingStale)) {
			return models.Failed
		}
		return models.Pending
	default:
		// PENDING / IN_PROGRESS / CANCEL_REQUESTED と、知らない値
		return models.Pending
	}
}

// squareCheckoutNeedsRefresh は Square に問い合わせ直す必要があるかを返す。
func squareCheckoutNeedsRefresh(checkout *models.SquareCheckout, now time.Time) bool {
	if checkout.CheckoutID == nil {
		return false
	}
	switch checkout.Status {
	case squareStatusCompleted:
		return checkout.PaidAmount == nil
	case squareStatusCanceled:
		return squareCheckoutOutcome(checkout, now) == models.Pending
	default:
		return true
	}
}

// applySquareCheckout は Square から受け取った checkout を記録に写す。
// COMPLETED から別の状態に戻すことはしない（Webhook の順序が前後しても壊れないように）。
func applySquareCheckout(record *models.SquareCheckout, remote *square.TerminalCheckout) {
	if remote.ID != "" && record.CheckoutID == nil {
		id := remote.ID
		record.CheckoutID = &id
	}
	if record.Status == squareStatusCompleted && remote.Status != squareStatusCompleted {
		return
	}
	if remote.Status != "" {
		record.Status = remote.Status
	}
	if remote.CancelReason != "" {
		reason := remote.CancelReason
		record.CancelReason = &reason
	}
	if len(remote.PaymentIDs) > 0 {
		record.PaymentIDs = append([]string(nil), remote.PaymentIDs...)
	}
}

// squarePaidAmount は決済の明細から受取額（円）を出す。
// 1 件でも COMPLETED でない決済があれば、まだ確定していないとしてエラーにする。
func squarePaidAmount(payments []*square.Payment) (int, error) {
	if len(payments) == 0 {
		return 0, errors.New("決済が見つからない")
	}
	total := int64(0)
	for _, payment := range payments {
		if payment.Status != squarePaymentCompleted {
			return 0, fmt.Errorf("決済 %s の状態が %s", payment.ID, payment.Status)
		}
		if payment.AmountMoney.Currency != "" && payment.AmountMoney.Currency != "JPY" {
			return 0, fmt.Errorf("決済 %s の通貨が %s", payment.ID, payment.AmountMoney.Currency)
		}
		total += payment.AmountMoney.Amount
	}
	return int(total), nil
}

// validateSquareCheckoutForOrder は、その決済で注文を作ってよいかを確かめる。
func validateSquareCheckoutForOrder(checkout *models.SquareCheckout, billingAmount int, now time.Time) error {
	if checkout.OrderID != nil {
		return errors.New("この決済は既に別の注文に使われています")
	}
	if outcome := squareCheckoutOutcome(checkout, now); outcome != models.Paid {
		return fmt.Errorf("この決済はまだ支払い済みになっていません（%s）", outcome)
	}
	if checkout.Amount != billingAmount {
		return fmt.Errorf("決済額 %d 円と請求額 %d 円が一致しません", checkout.Amount, billingAmount)
	}
	return nil
}

func toSquareCheckoutResponse(checkout *models.SquareCheckout, now time.Time) models.SquareCheckoutResponse {
	paymentIDs := checkout.PaymentIDs
	if paymentIDs == nil {
		paymentIDs = []string{}
	}
	var orderID *openapi_types.UUID
	if checkout.OrderID != nil {
		id := openapi_types.UUID(*checkout.OrderID)
		orderID = &id
	}
	return models.SquareCheckoutResponse{
		Id:           openapi_types.UUID(checkout.ID),
		CheckoutId:   checkout.CheckoutID,
		Status:       checkout.Status,
		Outcome:      squareCheckoutOutcome(checkout, now),
		CancelReason: checkout.CancelReason,
		Amount:       checkout.Amount,
		PaidAmount:   checkout.PaidAmount,
		PaymentType:  checkout.PaymentType,
		PaymentIds:   paymentIDs,
		ErrorMessage: checkout.ErrorMessage,
		OrderNumber:  checkout.OrderNumber,
		OrderId:      orderID,
		CreatedAt:    checkout.CreatedAt,
		UpdatedAt:    checkout.UpdatedAt,
	}
}

func validSquarePaymentType(paymentType models.SquarePaymentType) bool {
	switch paymentType {
	case models.CARDPRESENT, models.FELICAALL, models.QRCODE:
		return true
	}
	return false
}

// Square の idempotency_key の上限。
const squareIdempotencyKeyMaxLength = 64

func validateSquareCheckoutRequest(req models.SquareCheckoutCreateRequest) error {
	if req.IdempotencyKey == "" || len(req.IdempotencyKey) > squareIdempotencyKeyMaxLength {
		return fmt.Errorf("idempotency_key は 1〜%d 文字にしてください", squareIdempotencyKeyMaxLength)
	}
	if req.Amount < 1 {
		return errors.New("amount は 1 円以上にしてください")
	}
	if !validSquarePaymentType(req.PaymentType) {
		return fmt.Errorf("payment_type %q には対応していません", req.PaymentType)
	}
	return nil
}

// --------------------------------------------------
// Square との同期
// --------------------------------------------------

// refresh は未確定の記録を Square に問い合わせて最新にし、保存する。
// 問い合わせに失敗しても記録は返す（レジは次のポーリングで再試行する）。
func (h *SquareHandler) refresh(ctx context.Context, record *models.SquareCheckout) {
	if !h.enabled() || !squareCheckoutNeedsRefresh(record, h.now()) {
		return
	}
	if record.Status != squareStatusCompleted {
		remote, err := h.client.GetTerminalCheckout(ctx, *record.CheckoutID)
		if err != nil {
			log.Printf("square: failed to get checkout %s: %v", *record.CheckoutID, err)
			return
		}
		applySquareCheckout(record, remote)
	}
	h.verifyPayments(ctx, record)
	h.save(record)
}

// verifyPayments は COMPLETED の決済について、実際に受け取った額を Payments API で確かめる。
func (h *SquareHandler) verifyPayments(ctx context.Context, record *models.SquareCheckout) {
	if record.Status != squareStatusCompleted || record.PaidAmount != nil || !h.enabled() {
		return
	}
	payments := make([]*square.Payment, 0, len(record.PaymentIDs))
	for _, paymentID := range record.PaymentIDs {
		payment, err := h.client.GetPayment(ctx, paymentID)
		if err != nil {
			log.Printf("square: failed to get payment %s: %v", paymentID, err)
			return
		}
		payments = append(payments, payment)
	}
	paid, err := squarePaidAmount(payments)
	if err != nil {
		message := err.Error()
		record.ErrorMessage = &message
		return
	}
	record.PaidAmount = &paid
	record.ErrorMessage = nil
}

func (h *SquareHandler) save(record *models.SquareCheckout) {
	if err := h.db.Model(record).Select(
		"CheckoutID", "Status", "CancelReason", "PaymentIDs", "PaidAmount", "ErrorMessage", "UpdatedAt",
	).Updates(record).Error; err != nil {
		log.Printf("square: failed to save checkout %s: %v", record.ID, err)
	}
}

// --------------------------------------------------
// ハンドラー
// --------------------------------------------------

// GET /api/square/status
func (h *SquareHandler) GetStatus(c *gin.Context) {
	c.JSON(http.StatusOK, models.SquareStatusResponse{
		Enabled:        h.enabled(),
		Environment:    h.environment,
		WebhookEnabled: h.webhookEnabled(),
	})
}

// POST /api/square/checkouts
func (h *SquareHandler) CreateCheckout(c *gin.Context) {
	if !h.enabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Square 連携が設定されていません"})
		return
	}
	var req models.CreateSquareCheckoutJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateSquareCheckoutRequest(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	ctx := c.Request.Context()

	// 同じ idempotency_key の再送には、作り直さず同じものを返す。
	var existing models.SquareCheckout
	err := h.db.Where("idempotency_key = ?", req.IdempotencyKey).First(&existing).Error
	if err == nil {
		h.refresh(ctx, &existing)
		c.JSON(http.StatusOK, toSquareCheckoutResponse(&existing, h.now()))
		return
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 端末は 1 台なので、進行中の依頼があるうちは新しく出さない。
	// 前の依頼の結果を見ないまま次を出すと、どちらで支払われたか分からなくなる。
	if active, err := h.findActiveCheckout(ctx); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	} else if active != nil {
		c.JSON(http.StatusConflict, models.SquareCheckoutConflictResponse{
			Error:    "別の決済が進行中です。端末で終わらせるか、取り消してください",
			Checkout: toSquareCheckoutResponse(active, h.now()),
		})
		return
	}

	record := models.SquareCheckout{
		ID:             uuid.New(),
		IdempotencyKey: req.IdempotencyKey,
		DeviceID:       h.deviceID,
		Amount:         req.Amount,
		PaymentType:    string(req.PaymentType),
		Status:         squareStatusCreating,
		PaymentIDs:     []string{},
		OrderNumber:    req.OrderNumber,
	}
	if err := h.db.Create(&record).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	remote, err := h.client.CreateTerminalCheckout(ctx, req.IdempotencyKey, buildTerminalCheckout(&record))
	if err != nil {
		log.Printf("square: failed to create checkout %s: %v", record.ID, err)
		message := err.Error()
		record.Status = squareStatusError
		record.ErrorMessage = &message
		h.save(&record)
		c.JSON(http.StatusBadGateway, toSquareCheckoutResponse(&record, h.now()))
		return
	}
	applySquareCheckout(&record, remote)
	h.save(&record)
	c.JSON(http.StatusCreated, toSquareCheckoutResponse(&record, h.now()))
}

// buildTerminalCheckout は Square に送る checkout を組み立てる。
// reference_id にこちらの ID を入れておき、応答が失われても Webhook から行を引けるようにする。
func buildTerminalCheckout(record *models.SquareCheckout) square.TerminalCheckout {
	checkout := square.TerminalCheckout{
		AmountMoney:   square.Money{Amount: int64(record.Amount), Currency: "JPY"},
		ReferenceID:   record.ID.String(),
		DeviceOptions: square.DeviceCheckoutOptions{DeviceID: record.DeviceID},
		PaymentType:   record.PaymentType,
	}
	if record.OrderNumber != nil {
		checkout.Note = fmt.Sprintf("No.%d", *record.OrderNumber)
	}
	return checkout
}

// findActiveCheckout は結果がまだ決まっていない依頼を返す。無ければ nil。
func (h *SquareHandler) findActiveCheckout(ctx context.Context) (*models.SquareCheckout, error) {
	now := h.now()
	var candidates []models.SquareCheckout
	if err := h.db.
		Where("status NOT IN ? AND created_at > ?",
			[]string{squareStatusCompleted, squareStatusError},
			now.Add(-(squareCheckoutDeadline + squareTimeoutGrace + time.Minute))).
		Order("created_at DESC").
		Find(&candidates).Error; err != nil {
		return nil, err
	}
	for i := range candidates {
		candidate := &candidates[i]
		h.refresh(ctx, candidate)
		if squareCheckoutOutcome(candidate, h.now()) == models.Pending {
			return candidate, nil
		}
	}
	return nil, nil
}

func (h *SquareHandler) findCheckout(c *gin.Context) (*models.SquareCheckout, bool) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return nil, false
	}
	var record models.SquareCheckout
	if err := h.db.First(&record, "id = ?", id).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Checkout not found"})
			return nil, false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return nil, false
	}
	return &record, true
}

// GET /api/square/checkouts/:id
func (h *SquareHandler) GetCheckout(c *gin.Context) {
	record, ok := h.findCheckout(c)
	if !ok {
		return
	}
	h.refresh(c.Request.Context(), record)
	c.JSON(http.StatusOK, toSquareCheckoutResponse(record, h.now()))
}

// POST /api/square/checkouts/:id/cancel
func (h *SquareHandler) CancelCheckout(c *gin.Context) {
	if !h.enabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Square 連携が設定されていません"})
		return
	}
	record, ok := h.findCheckout(c)
	if !ok {
		return
	}
	if record.CheckoutID == nil {
		c.JSON(http.StatusConflict, models.SquareCheckoutConflictResponse{
			Error:    "Square に届いていない依頼は取り消せません",
			Checkout: toSquareCheckoutResponse(record, h.now()),
		})
		return
	}
	ctx := c.Request.Context()
	remote, err := h.client.CancelTerminalCheckout(ctx, *record.CheckoutID)
	if err != nil {
		// 既に完了していた・電子マネーで端末にエラーが出ているなど。最新の状態を添えて返す。
		log.Printf("square: failed to cancel checkout %s: %v", *record.CheckoutID, err)
		h.refresh(ctx, record)
		c.JSON(http.StatusConflict, models.SquareCheckoutConflictResponse{
			Error:    "取り消せませんでした。端末の画面を確認してください: " + err.Error(),
			Checkout: toSquareCheckoutResponse(record, h.now()),
		})
		return
	}
	applySquareCheckout(record, remote)
	h.verifyPayments(ctx, record)
	h.save(record)
	c.JSON(http.StatusOK, toSquareCheckoutResponse(record, h.now()))
}

// GET /api/square/checkouts/unlinked
func (h *SquareHandler) GetUnlinkedCheckouts(c *gin.Context) {
	var records []models.SquareCheckout
	if err := h.db.
		Where("status = ? AND order_id IS NULL", squareStatusCompleted).
		Order("created_at DESC").
		Find(&records).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	ctx := c.Request.Context()
	responses := make([]models.SquareCheckoutResponse, len(records))
	for i := range records {
		h.refresh(ctx, &records[i])
		responses[i] = toSquareCheckoutResponse(&records[i], h.now())
	}
	c.JSON(http.StatusOK, responses)
}

// POST /api/square/webhook
//
// レジが落ちていても、Square からの通知で記録を最新にしておく。照合
// （GET /api/square/checkouts/unlinked）はこの記録を見る。
func (h *SquareHandler) ReceiveWebhook(c *gin.Context) {
	if !h.webhookEnabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Webhook の署名鍵が設定されていません"})
		return
	}
	body, err := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !square.VerifySignature(h.webhookSignatureKey, h.webhookURL, body, c.GetHeader(square.SignatureHeader)) {
		c.JSON(http.StatusForbidden, gin.H{"error": "invalid signature"})
		return
	}
	event, err := square.ParseWebhookEvent(body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	remote := event.Data.Object.Checkout
	if remote == nil {
		// 購読していない種類の通知。Square に再送させないよう 200 で返す。
		c.Status(http.StatusOK)
		return
	}

	record, err := h.findByRemote(remote)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			// このシステム以外（Square の管理画面など）で作った checkout。
			log.Printf("square: webhook for unknown checkout %s (reference_id %q)", remote.ID, remote.ReferenceID)
			c.Status(http.StatusOK)
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	applySquareCheckout(record, remote)
	h.verifyPayments(c.Request.Context(), record)
	h.save(record)
	c.Status(http.StatusOK)
}

func (h *SquareHandler) findByRemote(remote *square.TerminalCheckout) (*models.SquareCheckout, error) {
	var record models.SquareCheckout
	if remote.ID != "" {
		err := h.db.First(&record, "checkout_id = ?", remote.ID).Error
		if err == nil {
			return &record, nil
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	// 作成の応答が失われて checkout_id を記録できていない場合は reference_id で引く。
	id, err := uuid.Parse(remote.ReferenceID)
	if err != nil {
		return nil, gorm.ErrRecordNotFound
	}
	if err := h.db.First(&record, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &record, nil
}

// --------------------------------------------------
// 注文との結び付け（OrderHandler から使う）
// --------------------------------------------------

var errSquareCheckoutUnusable = errors.New("square checkout cannot be used for this order")

// linkSquareCheckout は注文作成のトランザクションの中で、決済依頼を行ロックして
// 検証し、注文と結び付ける。order.ID は採番済みであること。
func linkSquareCheckout(tx *gorm.DB, checkoutID uuid.UUID, order *models.Order, now time.Time) error {
	var record models.SquareCheckout
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&record, "id = ?", checkoutID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return fmt.Errorf("%w: 決済が見つかりません", errSquareCheckoutUnusable)
		}
		return err
	}
	if err := validateSquareCheckoutForOrder(&record, order.BillingAmount, now); err != nil {
		return fmt.Errorf("%w: %s", errSquareCheckoutUnusable, err.Error())
	}
	return tx.Model(&record).Update("order_id", order.ID).Error
}
