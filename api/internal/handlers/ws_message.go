package handlers

import (
	"cafeore-pos/api/internal/models"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WSMessageType string

const (
	WSMessageTypeOrders      WSMessageType = "orders"
	WSMessageTypeMasterState WSMessageType = "master_state"
)

type WSMessage struct {
	Type        WSMessageType          `json:"type"`
	Orders      []models.OrderResponse `json:"orders,omitempty"`
	MasterState *models.MasterState    `json:"master_state,omitempty"`
}

func (h *OrderHandler) WSHandler(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	client := h.hub.Register(conn)

	// 接続直後に現在のデータをこの接続にだけ送信
	// （全体へ配り直すと、1台つながるたびに既存の全端末へ全件が流れてしまう）
	if msg, ok := ordersMessage(h.db); ok {
		client.Send(msg)
	}
	if msg, ok := masterStateMessage(h.db); ok {
		client.Send(msg)
	}

	// 切断されるまで接続を維持する
	client.ReadPump()
}

// 最新のオーダーストップ状態を WSMessage にする。まだ無ければ ok = false
func masterStateMessage(db *gorm.DB) (WSMessage, bool) {
	var state models.MasterState

	if err := db.
		Order("created_at DESC").
		First(&state).Error; err != nil {
		return WSMessage{}, false
	}

	return WSMessage{
		Type:        WSMessageTypeMasterState,
		MasterState: &state,
	}, true
}
