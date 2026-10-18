package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

// POST /api/orders/:id/recall - 呼び出し中の注文を、もう一度呼ぶ（呼び出し催促）。
// 注文には何も書かず、全部の画面に {"type":"order_recalled","order_id":"<id>"} で知らせるだけ（publishOrderRecalled）。
// 呼び出し画面は、この知らせを受けたら「お急ぎ、提供口までお越しください」と読み上げ、その番号をしばらく目立たせる。
// 呼び出し中（準備完了で、まだ提供していない）でなければ 409 にする。ほかの端末で提供したか、呼び出しを取り消したかもしれないので。
func (h *OrderHandler) RecallOrder(c *gin.Context) {
	id, ok := parseUUIDParam(c)
	if !ok {
		return
	}
	var order models.Order
	err := h.db.First(&order, "id = ?", id).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}
	// 画面の「お呼び出し中」（OrderEntity の status が calling）と同じ決め方
	if err == nil && (order.ReadyAt == nil || order.ServedAt != nil || order.CancelledAt != nil) {
		err = conflictErrorf("呼び出し中ではありません（ほかの端末で提供したか、呼び出しを取り消したかもしれません）")
	}
	if respondError(c, err) {
		return
	}
	c.Status(http.StatusNoContent)
	c.Writer.WriteHeaderNow()
	publishOrderRecalled(h.db, h.hub, id)
}

// publishOrderRecalled は呼び出し催促を、このインスタンスの画面へ配り、ほかのインスタンスへ DB の通知で知らせる。
// 注文は変わらないので、知らせを受け損ねた呼び出し画面は読み上げないだけ。送り直しはしない（もう一度押してもらう）。
func publishOrderRecalled(db *gorm.DB, hub *Hub, orderID uuid.UUID) {
	broadcastOrderRecalled(hub, orderID)
	notifyChanged(db, orderRecalledChannel, instanceID+" "+orderID.String())
}

// broadcastOrderRecalled は呼び出し催促を、このインスタンスの画面へだけ配る（ほかのインスタンスからの通知でも使う）。
func broadcastOrderRecalled(hub *Hub, orderID uuid.UUID) {
	_ = hub.Publish(func() (WSMessage, error) {
		return WSMessage{Type: WSMessageTypeOrderRecalled, OrderID: &orderID}, nil
	})
}
