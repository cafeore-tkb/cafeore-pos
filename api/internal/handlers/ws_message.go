package handlers

import (
	"cafeore-pos/api/internal/models"

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
	Type   WSMessageType          `json:"type"`
	Orders []models.OrderResponse `json:"orders"`
	// REST（GET /api/master-status）と同じ形で送る。models.MasterState は json タグが無く、
	// そのまま送ると "Type" のように大文字のキーになってフロントで読めない
	MasterState  *models.MasterStateResponse  `json:"master_state,omitempty"`
	CashierState *models.CashierStateResponse `json:"cashier_state,omitempty"`
}

func (h *OrderHandler) WSHandler(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	client := h.hub.Register(conn)

	// 接続直後に現在のデータをこの接続にだけ送信
	// （全体へ配り直すと、1台つながるたびに既存の全端末へ全件が流れてしまう）
	var initial []WSMessage
	if msg, ok := ordersMessage(h.db); ok {
		initial = append(initial, msg)
	}
	if msg, ok := masterStateMessage(h.db); ok {
		initial = append(initial, msg)
	}
	if msg, ok := cashierStateMessage(h.db); ok {
		initial = append(initial, msg)
	}
	client.SendInitial(initial...)

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

	response := toMasterStateResponse(&state)
	return WSMessage{
		Type:        WSMessageTypeMasterState,
		MasterState: &response,
	}, true
}
