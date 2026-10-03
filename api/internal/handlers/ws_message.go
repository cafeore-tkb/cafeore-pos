package handlers

import (
	"cafeore-pos/api/internal/models"

	"log"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type WSMessageType string

const (
	WSMessageTypeOrders       WSMessageType = "orders"
	WSMessageTypeMasterState  WSMessageType = "master_state"
	WSMessageTypeCashierState WSMessageType = "cashier_state"
)

type WSMessage struct {
	Type         WSMessageType               `json:"type"`
	Orders       []models.OrderResponse      `json:"orders,omitempty"`
	MasterState  *models.MasterStateResponse `json:"master_state,omitempty"`
	CashierState *models.CashierStateResponse `json:"cashier_state,omitempty"`
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
	broadcastMasterState(h.db, h.hub)
	broadcastCashierState(h.db, h.hub)

	// 接続維持（クライアントからのメッセージは今は無視）
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

// 最新のオーダーストップ状態を WebSocket の全クライアントへ流す。
//
// フロントは MasterStateResponse（created_at / type）の形で受ける。
// models.MasterState をそのまま流すと json タグが無いので
// CreatedAt / Type というキーになり、フロントが読めない。
func broadcastMasterState(db *gorm.DB, hub *Hub) {
	var state models.MasterState

	if err := db.
		Order("created_at DESC").
		First(&state).Error; err != nil {
		return
	}

	resp := toMasterStateResponse(&state)
	hub.Broadcast(WSMessage{
		Type:        WSMessageTypeMasterState,
		MasterState: &resp,
	})
}
