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
	// CaOS の今日のカード（全部）と列の担当者（1〜6 の全部）。カードか担当者が変わるたびと、つないだときに届く
	WSMessageTypeDrips WSMessageType = "drips"
	// 印刷キューの、まだ終わっていない仕事（待ち・印刷中・失敗）の全部。変わるたびと、つないだときに届く
	WSMessageTypePrintJobs WSMessageType = "print_jobs"
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
	// drips：CaOS の今日のカード（0 枚のときは省かれる）
	Drips []caos.Drip `json:"drips,omitempty"`
	// drips：CaOS の今日の列の担当者（1〜6 の 6 列が必ずある。担当者がいない列は name が空）
	Lanes []caos.Lane `json:"lanes,omitempty"`
	// print_jobs：印刷キューの、まだ終わっていない仕事（0 件のときは省かれる）
	PrintJobs []models.PrintJob `json:"print_jobs,omitempty"`
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
	if msg, ok := h.dripsMessage(); ok {
		initial = append(initial, msg)
	}
	if msg, ok := printJobsMessage(h.db); ok {
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
func publishOrder(db *gorm.DB, hub *Hub, orderID uuid.UUID) (models.OrderResponse, error) {
	resp, err := broadcastOrder(db, hub, orderID)
	if err == nil {
		notifyOrderChanged(db, orderID)
	}
	return resp, err
}

// 注文の削除を配信し、ほかのインスタンスにも知らせる。
func publishOrderDeleted(db *gorm.DB, hub *Hub, orderID uuid.UUID) {
	broadcastOrderDeleted(hub, orderID)
	notifyOrderChanged(db, orderID)
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
