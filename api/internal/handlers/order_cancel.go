package handlers

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// 注文のキャンセルと、現金の返金の記録。
//
// キャンセルした注文は消さずに cancelled_at を付けて残す（レジの「過去の注文」に「キャンセル」として出す）。
// 番号は使ったまま（次の注文は次の番号）、使った在庫も戻さない。作る画面（マスター・提供・CaOS・呼び出し）からは外す。
// 現金の返金は、レジが手でお金を返したことを cash_refunded_at に残す（売上・引換券の割引から外すのに使う）。
// どちらも付いていれば付けたときの時刻のまま変えない（もう一度呼んでも同じ結果を返す）。

var errNoCashPayment = errors.New("この注文に現金の支払いがありません")

// キャンセルした注文は、準備完了・提供・編集をしない
var errOrderCancelled = errors.New("注文はキャンセルされています（ほかの端末でキャンセルされたかもしれません）")

// cancelOrder は注文にキャンセルした時刻を付ける。配るのは呼ぶ側。Square の返金（SquareHandler）からも使う。
// 注文が無ければ gorm.ErrRecordNotFound を返す。
func cancelOrder(db *gorm.DB, orderID uuid.UUID, now time.Time) error {
	result := db.Model(&models.Order{}).Where("id = ? AND cancelled_at IS NULL", orderID).Update("cancelled_at", now)
	if result.Error != nil || result.RowsAffected > 0 {
		return result.Error
	}
	// 先にキャンセルされていたか、注文が無い
	return db.Select("id").First(&models.Order{}, "id = ?", orderID).Error
}

// paidByCash は、現金で受け取った分があるか（個別会計は支払いごとに見る）。
func paidByCash(order *models.Order) bool {
	if len(order.Payments) == 0 {
		return order.PaymentMethod == string(models.Cash)
	}
	for _, payment := range order.Payments {
		if payment.Method == string(models.Cash) {
			return true
		}
	}
	return false
}

// refundOrderCash は、現金で受け取った分を返したことを記録する。配るのは呼ぶ側。
// 注文が無ければ gorm.ErrRecordNotFound、現金の支払いが無ければ errNoCashPayment を返す。
func refundOrderCash(db *gorm.DB, orderID uuid.UUID, now time.Time) error {
	var order models.Order
	if err := db.Preload("Payments").First(&order, "id = ?", orderID).Error; err != nil {
		return err
	}
	if !paidByCash(&order) {
		return errNoCashPayment
	}
	return db.Model(&models.Order{}).Where("id = ? AND cash_refunded_at IS NULL", orderID).Update("cash_refunded_at", now).Error
}

// POST /api/orders/:id/cancel - 注文をキャンセルする（返金はしない）
func (h *OrderHandler) CancelOrder(c *gin.Context) {
	h.markOrder(c, cancelOrder)
}

// POST /api/orders/:id/cash-refund - 現金で受け取った分を返したことを記録する（キャンセルはしない）
func (h *OrderHandler) RefundOrderCash(c *gin.Context) {
	h.markOrder(c, refundOrderCash)
}

// markOrder は注文に印を付け、付けたあとの注文を配って応答する。
func (h *OrderHandler) markOrder(c *gin.Context, mark func(db *gorm.DB, orderID uuid.UUID, now time.Time) error) {
	orderID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}
	// DB に保存される精度にそろえる
	err = mark(h.db, orderID, time.Now().Truncate(time.Microsecond))
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	case errors.Is(err, errNoCashPayment):
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	resp, err := publishOrder(h.db, h.hub, orderID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
}
