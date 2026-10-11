// api/internal/handlers/square_refund.go
package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/square"
)

// 返金の状態（SquareCheckout.RefundStatus）。PENDING / COMPLETED / REJECTED / FAILED は
// Square の PaymentRefund.status で、REJECTED は FAILED にまとめて記録する。
// REQUESTING はこちらで使う独自の値で、Square に頼んでから応答を記録するまでの間。
// 応答が無かったときも REQUESTING のまま RefundError を入れ、頼み直しで確かめる。
const (
	squareRefundRequesting = "REQUESTING"
	squareRefundPending    = "PENDING"
	squareRefundCompleted  = "COMPLETED"
	squareRefundRejected   = "REJECTED"
	squareRefundFailed     = "FAILED"
)

// REQUESTING のまま応答を記録できていない返金（Square を呼んでいる間にサーバーが落ちた）を、
// 頼み直してよいとみなすまでの時間。Square を呼ぶのは決済ごとに 2〜3 回で、1 回 15 秒で打ち切る。
const squareRefundRequestingStale = 2 * time.Minute

// squareRefundAction は返金を頼まれたときにすること。
type squareRefundAction int

const (
	// squareRefundStart は新しいキーで返金を頼む。
	squareRefundStart squareRefundAction = iota
	// squareRefundResume は前に頼んだときと同じキーで頼み直す（応答が無かった・途中で落ちた）。
	squareRefundResume
	// squareRefundAccepted は Square が既に受け付けているので頼まない。注文が残っていれば消す。
	squareRefundAccepted
)

// squareRefundConflict は今は返金できない理由（409 で返す）。
type squareRefundConflict struct{ reason string }

func (e *squareRefundConflict) Error() string { return e.reason }

// squareRefundStale は、REQUESTING の返金が応答を待っても仕方ない状態かを返す。
func squareRefundStale(checkout *models.SquareCheckout, now time.Time) bool {
	return checkout.RefundError != nil ||
		checkout.RefundRequestedAt == nil ||
		now.After(checkout.RefundRequestedAt.Add(squareRefundRequestingStale))
}

// squareRefundOutcome は返金の状態をレジに見せる形にする。
func squareRefundOutcome(checkout *models.SquareCheckout, now time.Time) models.SquareRefundStatus {
	if checkout.RefundStatus == nil {
		return models.RefundNone
	}
	switch *checkout.RefundStatus {
	case squareRefundCompleted:
		return models.RefundRefunded
	case squareRefundFailed:
		return models.RefundFailed
	case squareRefundRequesting:
		// 応答が無く、返金できたか分からない。頼み直すと確かめられる。
		if squareRefundStale(checkout, now) {
			return models.RefundUnknown
		}
		return models.RefundPending
	default:
		// PENDING と、知らない値
		return models.RefundPending
	}
}

// squareRefundAllowsOrder は、返金の状態から見てその決済で注文を作ってよいかを返す。
// 返金が失敗したときだけお金が手元にあると分かるので使える。
func squareRefundAllowsOrder(checkout *models.SquareCheckout) bool {
	return checkout.RefundStatus == nil || *checkout.RefundStatus == squareRefundFailed
}

// decideSquareRefund は返金を頼まれたときに何をするかを決める。返金できなければエラーを返す。
func decideSquareRefund(checkout *models.SquareCheckout, now time.Time) (squareRefundAction, error) {
	if checkout.Status != squareStatusCompleted || checkout.PaidAmount == nil || len(checkout.PaymentIDs) == 0 {
		return 0, &squareRefundConflict{"支払いを確かめられていない決済は返金できません"}
	}
	if checkout.RefundStatus == nil {
		return squareRefundStart, nil
	}
	switch *checkout.RefundStatus {
	case squareRefundFailed:
		return squareRefundStart, nil
	case squareRefundRequesting:
		if squareRefundStale(checkout, now) {
			return squareRefundResume, nil
		}
		return 0, &squareRefundConflict{"返金を頼んでいる途中です。しばらく待ってください"}
	default:
		// PENDING / COMPLETED（と知らない値）。もう一度頼むと二重に返金されうる。
		return squareRefundAccepted, nil
	}
}

// squareRefundIdempotencyKey は決済ごとの返金の idempotency_key（45 文字まで）を作る。
func squareRefundIdempotencyKey(refundKey uuid.UUID, paymentID string) string {
	return uuid.NewSHA1(refundKey, []byte(paymentID)).String()
}

// squareRefundReason は Square の管理画面に出る返金の理由。
func squareRefundReason(checkout *models.SquareCheckout) string {
	if checkout.OrderNumber != nil {
		return fmt.Sprintf("No.%d の返金", *checkout.OrderNumber)
	}
	return "返金"
}

// squareRefundStatusOf は決済ごとの返金の状態をまとめる。
// 1 件でも失敗していれば FAILED、まだ決まっていないものがあれば PENDING、全て終われば COMPLETED。
func squareRefundStatusOf(statuses []string) (string, *string) {
	pending := false
	for _, status := range statuses {
		switch status {
		case squareRefundCompleted:
		case squareRefundFailed, squareRefundRejected:
			message := fmt.Sprintf("Square で返金が通りませんでした（%s）", status)
			return squareRefundFailed, &message
		default:
			pending = true
		}
	}
	if pending {
		return squareRefundPending, nil
	}
	return squareRefundCompleted, nil
}

// squareRefundUncertain は、Square が返金を受け付けたかどうか分からないエラーかを返す。
// 通信できなかった・Square 側の障害・回数制限は頼み直せば結果が分かる。
// それ以外の 4xx（交通系 IC など返金できない決済）は断られたと分かっている。
func squareRefundUncertain(err error) bool {
	var apiErr *square.APIError
	if !errors.As(err, &apiErr) {
		return true
	}
	return apiErr.StatusCode >= 500 || apiErr.StatusCode == http.StatusTooManyRequests
}

// beginRefund は決済依頼を行ロックして返金してよいか確かめ、Square に頼むなら REQUESTING にして保存する。
// 同時に押されても Square に頼むのは 1 件だけになる。返金できないときは *squareRefundConflict を返す。
func (h *SquareHandler) beginRefund(ctx context.Context, where string, arg any) (*models.SquareCheckout, squareRefundAction, error) {
	var record models.SquareCheckout
	var action squareRefundAction
	err := h.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&record, where, arg).Error; err != nil {
			return err
		}
		var err error
		action, err = decideSquareRefund(&record, h.now())
		if err != nil || action == squareRefundAccepted {
			return err
		}
		if action == squareRefundStart || record.RefundKey == nil {
			key := uuid.New()
			record.RefundKey = &key
			record.RefundIDs = []string{}
		}
		status := squareRefundRequesting
		now := h.now()
		record.RefundStatus = &status
		record.RefundError = nil
		record.RefundRequestedAt = &now
		return tx.Model(&record).Select(
			"RefundStatus", "RefundKey", "RefundIDs", "RefundError", "RefundRequestedAt", "UpdatedAt",
		).Updates(&record).Error
	})
	return &record, action, err
}

// requestRefunds は決済ごとに全額の返金を Square に頼み、結果を記録に写す（保存はしない）。
//
// 頼む前に決済を取り直し、既に返金が終わっている決済は飛ばす。処理中の返金があれば
// 新しく頼まずにそれを待つ（Square は完了した返金しか返金額に数えないので、
// 頼み直すと二重に返金されうる）。
func (h *SquareHandler) requestRefunds(ctx context.Context, record *models.SquareCheckout) {
	statuses := []string{}
	refundIDs := []string{}
	// uncertain なら REQUESTING のまま残し、頼み直しで同じキーを使う。
	fail := func(err error, uncertain bool) {
		message := err.Error()
		record.RefundError = &message
		if !uncertain {
			status := squareRefundFailed
			record.RefundStatus = &status
		}
		record.RefundIDs = refundIDs
	}
	for _, paymentID := range record.PaymentIDs {
		payment, err := h.client.GetPayment(ctx, paymentID)
		if err != nil {
			fail(fmt.Errorf("決済 %s を取得できませんでした: %w", paymentID, err), squareRefundUncertain(err))
			return
		}
		total := payment.TotalMoney
		if total.Amount == 0 {
			total = payment.AmountMoney
		}
		if total.Amount <= 0 {
			// 額が分からないまま進むと、返金せずに返金済みとみなしてしまう。
			fail(fmt.Errorf("決済 %s の額を確かめられませんでした", paymentID), false)
			return
		}
		refunded := int64(0)
		if payment.RefundedMoney != nil {
			refunded = payment.RefundedMoney.Amount
		}
		if refunded >= total.Amount {
			// 管理画面などで返金が済んでいる。
			statuses = append(statuses, squareRefundCompleted)
			continue
		}

		var inFlight *square.PaymentRefund
		for _, refundID := range payment.RefundIDs {
			refund, err := h.client.GetPaymentRefund(ctx, refundID)
			if err != nil {
				fail(fmt.Errorf("返金 %s を取得できませんでした: %w", refundID, err), squareRefundUncertain(err))
				return
			}
			if refund.Status == squareRefundPending {
				inFlight = refund
				break
			}
		}
		if inFlight == nil {
			if refunded > 0 {
				fail(fmt.Errorf("決済 %s は一部（%d 円）返金済みです。残りは Square の管理画面から返金してください", paymentID, refunded), false)
				return
			}
			refund, err := h.client.RefundPayment(ctx,
				squareRefundIdempotencyKey(*record.RefundKey, paymentID), paymentID, total, squareRefundReason(record))
			if err != nil {
				fail(err, squareRefundUncertain(err))
				return
			}
			inFlight = refund
		}
		refundIDs = append(refundIDs, inFlight.ID)
		statuses = append(statuses, inFlight.Status)
	}
	status, message := squareRefundStatusOf(statuses)
	record.RefundStatus = &status
	record.RefundError = message
	record.RefundIDs = refundIDs
}

// refreshRefund は結果待ちの返金を Square に問い合わせて最新にし、保存する。
// 問い合わせに失敗しても記録はそのまま（次の問い合わせで再試行する）。
func (h *SquareHandler) refreshRefund(ctx context.Context, record *models.SquareCheckout) {
	if !h.enabled() || record.RefundStatus == nil || *record.RefundStatus != squareRefundPending || len(record.RefundIDs) == 0 {
		return
	}
	statuses := make([]string, 0, len(record.RefundIDs))
	for _, refundID := range record.RefundIDs {
		refund, err := h.client.GetPaymentRefund(ctx, refundID)
		if err != nil {
			log.Printf("square: failed to get refund %s: %v", refundID, err)
			return
		}
		statuses = append(statuses, refund.Status)
	}
	status, message := squareRefundStatusOf(statuses)
	record.RefundStatus = &status
	record.RefundError = message
	h.saveRefund(record, squareRefundPending)
}

// saveRefund は返金の列だけを、DB の記録が読んだときと同じ返金（状態が expected で、RefundKey が同じ）の
// ままなら保存する。決済の状態の保存（save）とは列を分けている。
//
// ロックせずに読んだ記録を書き戻すので、その間に別のリクエストが進めた状態を古い内容で上書きしうる
// （PENDING → FAILED の直後に頼み直して REQUESTING になったものを FAILED に戻すと、さらに別の
// 頼み直しが通って二重に返金されうる）。保存できなかったら、record を DB の今の状態に読み直す。
func (h *SquareHandler) saveRefund(record *models.SquareCheckout, expected string) {
	query := h.db.Model(record).Where("refund_status = ?", expected)
	if record.RefundKey != nil {
		query = query.Where("refund_key = ?", *record.RefundKey)
	}
	result := query.Select("RefundStatus", "RefundIDs", "RefundError", "UpdatedAt").Updates(record)
	if result.Error != nil {
		log.Printf("square: failed to save refund of checkout %s: %v", record.ID, result.Error)
		return
	}
	if result.RowsAffected > 0 {
		return
	}
	log.Printf("square: refund of checkout %s changed elsewhere; not overwriting", record.ID)
	var current models.SquareCheckout
	if err := h.db.First(&current, "id = ?", record.ID).Error; err != nil {
		log.Printf("square: failed to reload checkout %s: %v", record.ID, err)
		return
	}
	*record = current
}

// refund は決済依頼を全額返金し、Square が受け付けたら結び付いた注文を消して応答する。
func (h *SquareHandler) refund(c *gin.Context, where string, arg any, notFound string) {
	if !h.enabled() {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "Square 連携が設定されていません"})
		return
	}
	ctx := c.Request.Context()
	record, action, err := h.beginRefund(ctx, where, arg)
	if err != nil {
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": notFound})
		case errors.As(err, new(*squareRefundConflict)):
			c.JSON(http.StatusConflict, models.SquareCheckoutConflictResponse{
				Error:    err.Error(),
				Checkout: toSquareCheckoutResponse(record, h.now()),
			})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}

	if action != squareRefundAccepted {
		h.requestRefunds(ctx, record)
		h.saveRefund(record, squareRefundRequesting)
	}
	if outcome := squareRefundOutcome(record, h.now()); outcome != models.RefundPending && outcome != models.RefundRefunded {
		log.Printf("square: refund of checkout %s was not accepted (%s)", record.ID, outcome)
		c.JSON(http.StatusBadGateway, toSquareCheckoutResponse(record, h.now()))
		return
	}

	// お金は返したので、注文は消す。消せなくても返金は取り消さない（もう一度呼ぶと注文だけを消す）。
	// PENDING でも消す。あとで Square で失敗したら、決済は「未登録の Square 決済」に理由付きで出るので、
	// そこで頼み直すか、注文を登録し直す。COMPLETED まで待つと、注文の付いた返金待ちを誰かが確かめて
	// 消す仕組みが別に要る。
	if record.OrderID != nil {
		if err := h.orders.deleteOrder(*record.OrderID); err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "返金は受け付けましたが、注文を消せませんでした。もう一度返金を押すと注文だけを消します: " + err.Error(),
			})
			return
		}
		record.OrderID = nil
	}
	c.JSON(http.StatusOK, toSquareCheckoutResponse(record, h.now()))
}

// POST /api/square/checkouts/:id/refund
func (h *SquareHandler) RefundCheckout(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}
	h.refund(c, "id = ?", id, "Checkout not found")
}

// POST /api/orders/:id/square-refund
func (h *SquareHandler) RefundOrder(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}
	h.refund(c, "order_id = ?", id, "この注文に Square の決済がありません")
}
