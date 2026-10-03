package handlers

import (
	"cafeore-pos/api/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type WSMessageType string

const (
	// 全注文。接続直後にその端末にだけ送る
	WSMessageTypeOrders WSMessageType = "orders"
	// 作成・変更された1件の注文
	WSMessageTypeOrder WSMessageType = "order"
	// 削除された注文の ID
	WSMessageTypeOrderDeleted WSMessageType = "order_deleted"
	WSMessageTypeMasterState  WSMessageType = "master_state"
)

type WSMessage struct {
	Type    WSMessageType          `json:"type"`
	Orders  []models.OrderResponse `json:"orders,omitempty"`
	Order   *models.OrderResponse  `json:"order,omitempty"`
	OrderID *uuid.UUID             `json:"order_id,omitempty"`
	// REST（GET /api/master-status）と同じ形で送る。models.MasterState は json タグが無く、
	// そのまま送ると "Type" のように大文字のキーになってフロントで読めない
	MasterState *models.MasterStateResponse `json:"master_state,omitempty"`
}

func (h *OrderHandler) WSHandler(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	// 接続は送信側（Hub）が閉じる
	defer h.hub.Unregister(conn)

	// 接続直後に現在のデータを、この端末にだけ送る
	if err := h.hub.RegisterWithSnapshot(conn, func() ([]WSMessage, error) {
		var orders []models.Order
		if err := preloadOrder(h.db).Find(&orders).Error; err != nil {
			return nil, err
		}
		responses := make([]models.OrderResponse, len(orders))
		for i := range orders {
			responses[i] = toOrderResponse(&orders[i])
		}
		msgs := []WSMessage{{Type: WSMessageTypeOrders, Orders: responses}}
		if state, ok := latestMasterState(h.db); ok {
			response := toMasterStateResponse(&state)
			msgs = append(msgs, WSMessage{Type: WSMessageTypeMasterState, MasterState: &response})
		}
		return msgs, nil
	}); err != nil {
		return
	}

	// 接続維持（クライアントからのメッセージは今は無視）
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
}

// 注文を読み直して、その1件を配信する。読み直した注文のレスポンスを返す。
func publishOrder(db *gorm.DB, hub *Hub, orderID uuid.UUID) (models.OrderResponse, error) {
	var resp models.OrderResponse
	err := hub.Publish(func() (WSMessage, error) {
		var order models.Order
		if err := preloadOrder(db).First(&order, "id = ?", orderID).Error; err != nil {
			return WSMessage{}, err
		}
		resp = toOrderResponse(&order)
		return WSMessage{Type: WSMessageTypeOrder, Order: &resp}, nil
	})
	return resp, err
}

func publishOrderDeleted(hub *Hub, orderID uuid.UUID) {
	_ = hub.Publish(func() (WSMessage, error) {
		return WSMessage{Type: WSMessageTypeOrderDeleted, OrderID: &orderID}, nil
	})
}

func latestMasterState(db *gorm.DB) (models.MasterState, bool) {
	var state models.MasterState
	if err := db.Order("created_at DESC").First(&state).Error; err != nil {
		return state, false
	}
	return state, true
}
