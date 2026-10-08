package handlers

import (
	"cafeore-pos/api/internal/caos"
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
	// レジが編集中の注文と直前に確定した注文の ID
	WSMessageTypeCashierState WSMessageType = "cashier_state"
	// CaOS（ドリップ管制）の今日の盤面。接続したときと、変わるたびに全部を送る
	WSMessageTypeDrips WSMessageType = "drips"
)

type WSMessage struct {
	Type    WSMessageType          `json:"type"`
	Orders  []models.OrderResponse `json:"orders"`
	Order   *models.OrderResponse  `json:"order,omitempty"`
	OrderID *uuid.UUID             `json:"order_id,omitempty"`
	// REST（GET /api/master-status）と同じ形で送る。models.MasterState は json タグが無く、
	// そのまま送ると "Type" のように大文字のキーになってフロントで読めない
	MasterState  *models.MasterStateResponse  `json:"master_state,omitempty"`
	CashierState *models.CashierStateResponse `json:"cashier_state,omitempty"`
	// CaOS の盤面のカード（openapi の CaosCard の形）。0 枚なら省く
	Drips []caos.Card `json:"drips,omitempty"`
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
	if msg, ok := h.hub.boardMessage(); ok {
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

// 注文を読み直して、その1件を配信する。読み直した注文のレスポンスを返す。
// ほかのインスタンスにも DB の通知で知らせる（order_listener.go）。
// 通知は自分の配信の成否に関わらず送る。DB にはもう書けていて、受けた側は注文 ID から読み直すだけなので、
// ここでの読み直しが一時的に失敗しても、ほかのインスタンスの画面は新しい状態になる。
// CaOS の盤面は注文のカップから組み立てるので、盤面も配り直す。
func publishOrder(db *gorm.DB, hub *Hub, orderID uuid.UUID) (models.OrderResponse, error) {
	resp, err := broadcastOrder(db, hub, orderID)
	notifyOrderChanged(db, orderID)
	hub.RequestBoard()
	return resp, err
}

// 注文の削除を配信し、ほかのインスタンスにも知らせる。CaOS の盤面も配り直す。
func publishOrderDeleted(db *gorm.DB, hub *Hub, orderID uuid.UUID) {
	broadcastOrderDeleted(hub, orderID)
	notifyOrderChanged(db, orderID)
	hub.RequestBoard()
}

// 注文を読み直して、このインスタンスにつないでいる画面へだけ配る。
func broadcastOrder(db *gorm.DB, hub *Hub, orderID uuid.UUID) (models.OrderResponse, error) {
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

func broadcastOrderDeleted(hub *Hub, orderID uuid.UUID) {
	_ = hub.Publish(func() (WSMessage, error) {
		return WSMessage{Type: WSMessageTypeOrderDeleted, OrderID: &orderID}, nil
	})
}
