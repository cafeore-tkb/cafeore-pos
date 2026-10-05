// api/internal/handlers/orders.go
package handlers

import (
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

type OrderHandler struct {
	db        *gorm.DB
	hub       *Hub
	inventory *Inventory
	// CaOS の盤面。注文の変更を同じトランザクションでカードに反映する（nil なら連動しない）
	caos *caos.Store
	// 全注文の配信の依頼。broadcastOrders を参照
	broadcastRequests chan struct{}
	// CaOS の今日のカードの配信の依頼。broadcastDrips を参照
	dripsRequests chan struct{}
}

func NewOrderHandler(db *gorm.DB, hub *Hub, inventory *Inventory, caosStore *caos.Store) *OrderHandler {
	h := &OrderHandler{db: db, hub: hub, inventory: inventory, caos: caosStore,
		broadcastRequests: make(chan struct{}, 1), dripsRequests: make(chan struct{}, 1)}
	go h.runOrderBroadcaster()
	go h.runDripsBroadcaster()
	return h
}

// 注文履歴では販売終了（論理削除）したメニューも参照する。
// 注文自体や販売用マスター一覧のスコープは変更しない。
func preloadOrder(db *gorm.DB) *gorm.DB {
	return db.Preload("OrderMenus.Menu", func(db *gorm.DB) *gorm.DB {
		return db.Unscoped()
	}).Preload("OrderMenus.Menu.MenuItems.Item.ItemType").Preload("Comments")
}

var errInvalidOrderMenus = errors.New("invalid order menus")

// 既存明細はIDで識別し、担当者以外の保存値は引き継ぐ。
// 新規明細だけ販売中のマスターから価格・名称をスナップショットする。
func buildOrderMenus(orderID uuid.UUID, requests []models.MenuInfoCreate, existing []models.OrderMenu, menus []models.Menu) ([]models.OrderMenu, error) {
	byID := make(map[uuid.UUID]models.OrderMenu, len(existing))
	for _, line := range existing {
		byID[line.ID] = line
	}
	masters := make(map[uuid.UUID]models.Menu, len(menus))
	for _, menu := range menus {
		if !menu.DeletedAt.Valid {
			masters[menu.ID] = menu
		}
	}
	lines := make([]models.OrderMenu, 0, len(requests))
	for _, request := range requests {
		menuID := uuid.UUID(request.MenuId)
		line := models.OrderMenu{ID: uuid.New(), OrderID: orderID, MenuID: menuID, Assignee: request.Assignee}
		if request.OrderMenuId != nil {
			old, ok := byID[uuid.UUID(*request.OrderMenuId)]
			if !ok || old.OrderID != orderID || old.MenuID != menuID {
				return nil, errInvalidOrderMenus
			}
			line.ID, line.MenuName, line.UnitPrice = old.ID, old.MenuName, old.UnitPrice
			delete(byID, old.ID) // 同じ明細を二重に指定することはできない
		} else {
			menu, ok := masters[menuID]
			if !ok {
				return nil, errInvalidOrderMenus
			}
			line.MenuName, line.UnitPrice = menu.Name, menu.Price
		}
		lines = append(lines, line)
	}
	return lines, nil
}

func loadOrderMenus(db *gorm.DB, orderID uuid.UUID, requests []models.MenuInfoCreate, existing []models.OrderMenu) ([]models.OrderMenu, error) {
	var ids []uuid.UUID
	for _, request := range requests {
		if request.OrderMenuId == nil {
			ids = append(ids, uuid.UUID(request.MenuId))
		}
	}
	var menus []models.Menu
	if len(ids) > 0 {
		if err := db.Where("id IN ?", ids).Find(&menus).Error; err != nil {
			return nil, err
		}
	}
	return buildOrderMenus(orderID, requests, existing, menus)
}

// DB models → API models 変換関数
func toOrderResponse(order *models.Order) models.OrderResponse {
	resp := models.OrderResponse{
		Id:                openapi_types.UUID(order.ID),
		OrderId:           order.OrderId,
		CreatedAt:         order.CreatedAt,
		ReadyAt:           order.ReadyAt,
		ServedAt:          order.ServedAt,
		BillingAmount:     order.BillingAmount,
		Received:          order.Received,
		DiscountOrderId:   &order.DiscountOrderId,
		DiscountOrderCups: &order.DiscountOrderCups,
		Menus:             make([]models.MenuInfo, 0, len(order.OrderMenus)),
	}
	// Menus変換
	if len(order.OrderMenus) > 0 {
		menus := make([]models.MenuInfo, 0, len(order.OrderMenus))
		for _, oi := range order.OrderMenus {
			menuInfo := models.MenuInfo{
				Id: openapi_types.UUID(oi.ID), MenuName: oi.MenuName, UnitPrice: oi.UnitPrice,
				Assignee: oi.Assignee, Menu: toMenuResponse(&oi.Menu),
			}
			menus = append(menus, menuInfo)
		}
		resp.Menus = menus
	}
	// Comments変換
	if len(order.Comments) > 0 {
		comments := make([]models.CommentResponse, len(order.Comments))
		for i, comment := range order.Comments {
			comments[i] = toCommentResponse(&comment)
		}
		resp.Comments = &comments
	}

	return resp
}

// 配信の依頼を受けてから実際に送るまでの待ち時間。この間に来た依頼は 1 回にまとめる。
//
// API で注文を書き換えると、ハンドラー自身の依頼と、DB の orders_changed 通知
// （ListenOrderChanges）の両方から依頼が来る。全注文を毎回送るので、二重に送らないようにしている。
const orderBroadcastDelay = 30 * time.Millisecond

// broadcastOrders は全注文の配信を依頼する。すぐに戻り、少し待ってから 1 回だけ送る。
func (h *OrderHandler) broadcastOrders() {
	select {
	case h.broadcastRequests <- struct{}{}:
	default:
		// 既に依頼が溜まっている。その配信に今の状態も含まれる
	}
}

func (h *OrderHandler) runOrderBroadcaster() {
	for range h.broadcastRequests {
		time.Sleep(orderBroadcastDelay)
		select {
		case <-h.broadcastRequests:
		default:
		}
		h.sendOrders()
	}
}

// 全注文を読み直して WebSocket へ送る。
func (h *OrderHandler) sendOrders() {
	var orders []models.Order
	if err := preloadOrder(h.db).Find(&orders).Error; err != nil {
		return
	}
	responses := make([]models.OrderResponse, len(orders))
	for i, o := range orders {
		responses[i] = toOrderResponse(&o)
	}
	h.hub.Broadcast(WSMessage{
		Type:   WSMessageTypeOrders,
		Orders: responses,
	})
}

// GET /api/orders - オーダー一覧取得
func (h *OrderHandler) GetOrders(c *gin.Context) {
	var orders []models.Order
	if err := preloadOrder(h.db).Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// API型に変換
	responses := make([]models.OrderResponse, len(orders))
	for i, order := range orders {
		responses[i] = toOrderResponse(&order)
	}

	c.JSON(http.StatusOK, responses)
}

// POST /api/orders - オーダー作成
func (h *OrderHandler) CreateOrder(c *gin.Context) {
	var req models.CreateOrderJSONRequestBody

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// API型 → DB型に変換
	order := models.Order{
		ID:                uuid.New(),
		OrderId:           req.OrderId,
		CreatedAt:         time.Now(),
		BillingAmount:     req.BillingAmount,
		Received:          req.Received,
		DiscountOrderCups: 0,
	}

	if req.DiscountOrderId != nil {
		order.DiscountOrderId = *req.DiscountOrderId
	}

	if req.DiscountOrderCups != nil {
		order.DiscountOrderCups = *req.DiscountOrderCups
	}

	// コメントの作成
	if req.Comments != nil && len(*req.Comments) > 0 {
		comments := make([]models.Comment, len(*req.Comments))
		for i, commentReq := range *req.Comments {
			comments[i] = models.Comment{
				Author:    commentReq.Author,
				Text:      commentReq.Text,
				CreatedAt: time.Now(),
			}
		}
		order.Comments = comments
	}

	if len(req.MenuIds) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "menu_ids is required"})
		return
	}

	if err := h.db.Transaction(func(tx *gorm.DB) error {
		locked := h.lockCaos(tx, order.CreatedAt)
		lines, err := loadOrderMenus(tx, order.ID, req.MenuIds, nil)
		if err != nil {
			return err
		}
		order.OrderMenus = lines
		if err := tx.Create(&order).Error; err != nil {
			return err
		}
		if locked {
			h.syncCaos(tx, caos.OrderRef{ID: order.ID, CreatedAt: order.CreatedAt})
		}
		return nil
	}); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errInvalidOrderMenus) {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	// 関連データをロード
	var loaded models.Order
	if err := preloadOrder(h.db).
		First(&loaded, "id = ?", order.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toOrderResponse(&loaded))
	h.broadcastOrders()
	h.broadcastDrips()
	go func() { h.inventory.CheckAlerts(h.inventory.ResourceIDsForOrder(order.ID)) }()
}

// GET /api/orders/:id - オーダー取得
func (h *OrderHandler) GetOrder(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var order models.Order
	if err := preloadOrder(h.db).First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toOrderResponse(&order))
}

// PUT /api/orders/:id - オーダー更新
func (h *OrderHandler) UpdateOrder(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var req models.UpdateOrderJSONRequestBody

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var order models.Order
	if err := preloadOrder(h.db).First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 明細が減ったときも閾値の記録を戻せるよう、変更前の分も見る。
	resourcesBefore := h.inventory.ResourceIDsForOrder(order.ID)

	err = h.db.Transaction(func(tx *gorm.DB) error {
		locked := h.lockCaos(tx, order.CreatedAt)
		// 明細の引き継ぎは、ロックを取ったあとに読み直した注文で行う
		if err := preloadOrder(tx).Clauses(clause.Locking{Strength: "UPDATE"}).First(&order, "id = ?", order.ID).Error; err != nil {
			return err
		}
		orderMenus, err := loadOrderMenus(tx, order.ID, req.MenuIds, order.OrderMenus)
		if err != nil {
			return err
		}
		// 準備完了・提供済みは、PUT では付けるだけで、外したり付け直したりしない（外すのは PATCH の切り替えで行う）。
		// 画面が持っている古い注文で編集したときに、CaOS の「次へ」などが付けた ready_at を消さないため
		readyAt, servedAt := order.ReadyAt, order.ServedAt
		if readyAt == nil {
			readyAt = req.ReadyAt
		}
		if servedAt == nil {
			servedAt = req.ServedAt
		}
		if err := tx.Model(&order).Updates(map[string]any{
			"order_id":            req.OrderId,
			"ready_at":            readyAt,
			"served_at":           servedAt,
			"billing_amount":      req.BillingAmount,
			"received":            req.Received,
			"discount_order_id":   req.DiscountOrderId,
			"discount_order_cups": req.DiscountOrderCups,
		}).Error; err != nil {
			return err
		}
		if err := tx.Where("order_id = ?", order.ID).Delete(&models.OrderMenu{}).Error; err != nil {
			return err
		}
		if len(orderMenus) > 0 {
			if err := tx.Create(&orderMenus).Error; err != nil {
				return err
			}
		}
		if locked {
			h.syncCaos(tx, caos.OrderRef{ID: order.ID, CreatedAt: order.CreatedAt})
		}
		return nil
	})
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errInvalidOrderMenus) {
			status = http.StatusBadRequest
		}
		// ロックを待っている間に消された
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	var loaded models.Order
	if err := preloadOrder(h.db).First(&loaded, "id = ?", order.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toOrderResponse(&loaded))
	h.broadcastOrders()
	h.broadcastDrips()
	go func() {
		h.inventory.CheckAlerts(mergeResourceIDs(resourcesBefore, h.inventory.ResourceIDsForOrder(order.ID)))
	}()
}

// DELETE /api/orders/:id - オーダー削除
func (h *OrderHandler) DeleteOrder(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	// オーダーアイテムの関連も削除
	var order models.Order
	if err := preloadOrder(h.db).First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 明細を消す前に、閾値の記録を戻す対象を取っておく
	resources := h.inventory.ResourceIDsForOrder(order.ID)

	// 注文明細とオーダーを削除し、CaOS の盤面からもその注文のカードを片付ける
	var deleted int64
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		locked := h.lockCaos(tx, order.CreatedAt)
		if err := tx.Where("order_id = ?", order.ID).Delete(&models.OrderMenu{}).Error; err != nil {
			return err
		}
		result := tx.Delete(&models.Order{}, "id = ?", orderID)
		if result.Error != nil {
			return result.Error
		}
		deleted = result.RowsAffected
		if locked {
			h.syncCaos(tx, caos.OrderRef{ID: order.ID, CreatedAt: order.CreatedAt})
		}
		return nil
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if deleted == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Order deleted successfully"})
	h.broadcastDrips()
	go h.inventory.CheckAlerts(resources)
}

// PATCH /api/orders/:id/ready - オーダーを準備完了にする
func (h *OrderHandler) MarkOrderReady(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var order models.Order
	if err := h.db.First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 体に {"ready": true|false} があればその状態にする（何度送っても同じ。CaOS の画面が使う）。
	// 無ければ今までどおり、準備完了と未完了を切り替える
	var req struct {
		Ready *bool `json:"ready"`
	}
	// 体が空なら（分割送信で ContentLength が分からないときも）体なしとして扱う
	if err := c.ShouldBindJSON(&req); err != nil && !errors.Is(err, io.EOF) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 準備完了になったら、同じトランザクションで CaOS のその注文のカードを抽出終了にする
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		locked := h.lockCaos(tx, order.CreatedAt)
		// 切り替えは、ロックを取ったあとに読み直した状態で決める（待っている間にほかの端末が ready_at を変えていても、
		// 古い値で上書きしたり逆に切り替えたりしない）。書くのも ready_at だけ
		if err := lockOrder(tx, &order); err != nil {
			return err
		}
		ready := order.ReadyAt == nil
		if req.Ready != nil {
			ready = *req.Ready
		}
		if ready == (order.ReadyAt != nil) {
			return nil // もうその状態
		}
		var readyAt *time.Time
		if ready {
			now := time.Now()
			readyAt = &now
		}
		if err := tx.Model(&models.Order{}).Where("id = ?", order.ID).Updates(map[string]any{"ready_at": readyAt}).Error; err != nil {
			return err
		}
		if locked {
			h.syncCaos(tx, caos.OrderRef{ID: order.ID, CreatedAt: order.CreatedAt})
		}
		return nil
	}); err != nil {
		// ロックを待っている間に消された
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := preloadOrder(h.db).First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toOrderResponse(&order))
	h.broadcastOrders()
	h.broadcastDrips()
}

// PATCH /api/orders/:id/served - オーダーを提供済みにする
func (h *OrderHandler) MarkOrderServed(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var order models.Order
	if err := h.db.First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 提供済みになったら、同じトランザクションで CaOS のその注文のカードを抽出終了にする
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		locked := h.lockCaos(tx, order.CreatedAt)
		// 切り替えは、ロックを取ったあとに読み直した状態で決める（MarkOrderReady と同じ）。書くのも served_at と ready_at だけ
		if err := lockOrder(tx, &order); err != nil {
			return err
		}
		var at *time.Time
		if order.ServedAt == nil {
			now := time.Now()
			at = &now
		}
		if err := tx.Model(&models.Order{}).Where("id = ?", order.ID).Updates(map[string]any{"served_at": at, "ready_at": at}).Error; err != nil {
			return err
		}
		if locked {
			h.syncCaos(tx, caos.OrderRef{ID: order.ID, CreatedAt: order.CreatedAt})
		}
		return nil
	}); err != nil {
		// ロックを待っている間に消された
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := preloadOrder(h.db).First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toOrderResponse(&order))
	h.broadcastOrders()
	h.broadcastDrips()
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

// lockOrder は tx の中で注文の行を読み直してロックする（読んでから書くまでに、ほかの処理に変えられないように）。
func lockOrder(tx *gorm.DB, order *models.Order) error {
	return tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(order, "id = ?", order.ID).Error
}
