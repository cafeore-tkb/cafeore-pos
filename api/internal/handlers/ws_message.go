package handlers

import (
	"cafeore-pos/api/internal/models"

	"log"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WSMessageType string

const (
	WSMessageTypeOrders      WSMessageType = "orders"
	WSMessageTypeMasterState WSMessageType = "master_state"
)

type WSMessage struct {
	Type   WSMessageType          `json:"type"`
	Orders []models.OrderResponse `json:"orders,omitempty"`
	// REST（GET /api/master-status）と同じ形で送る。models.MasterState は json タグが無く、
	// そのまま送ると "Type" のように大文字のキーになってフロントで読めない
	MasterState *models.MasterStateResponse `json:"master_state,omitempty"`
}

func (h *OrderHandler) WSHandler(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	defer func() {
		h.hub.Unregister(conn)
		if err := conn.Close(); err != nil {
    	log.Println("failed to close connection:", err)
		}
	}()

	h.hub.Register(conn)

	// 接続直後に現在のデータを送信
	h.broadcastOrders()
	h.broadcastMasterState()

	// 接続維持（クライアントからのメッセージは今は無視）
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

func (h *OrderHandler) broadcastMasterState() {
	var state models.MasterState

	if err := h.db.
		Order("created_at DESC").
		First(&state).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return
		}
		return
	}

	response := toMasterStateResponse(&state)
	h.hub.Broadcast(WSMessage{
		Type:        WSMessageTypeMasterState,
		MasterState: &response,
	})
}
