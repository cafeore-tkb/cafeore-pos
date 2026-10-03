// api/internal/handlers/orders.go
package handlers

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type OrderHandler struct {
	db  *gorm.DB
	hub *Hub
}

func NewOrderHandler(db *gorm.DB, hub *Hub) *OrderHandler {
	return &OrderHandler{db: db, hub: hub}
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

// グッズの item_type 名。item_type には種別を表すフラグ列が無く、フロント（getDrinkCups など）も
// 名前で判定しているので、ここでも名前で判定する。判定は isGoods に集約する。
const itemTypeOthers = "others"

// グッズの構成品なら true。"others" 以外（名前の変更や新しい種別も含む）は飲み物として扱うので、
// 判定がずれても提供済みにならない側に倒れる。
func isGoods(item models.Item) bool {
	return item.ItemType.Name == itemTypeOthers
}

// 構成品がグッズだけなら true。構成品が1つも無いときは、提供済みにしてよいか
// 分からないので false にする。
func onlyGoods(menus []models.Menu) bool {
	found := false
	for _, menu := range menus {
		for _, menuItem := range menu.MenuItems {
			if !isGoods(menuItem.Item) {
				return false
			}
			found = true
		}
	}
	return found
}

// 明細がグッズだけなら true。クライアントの値は使わず、DB のメニュー構成で判定する。
// 既存明細は販売終了したメニューを指すこともあるので、論理削除も含めて読む。
func isGoodsOnly(db *gorm.DB, lines []models.OrderMenu) (bool, error) {
	ids := make([]uuid.UUID, 0, len(lines))
	for _, line := range lines {
		ids = append(ids, line.MenuID)
	}
	var menus []models.Menu
	if len(ids) > 0 {
		if err := preloadMenu(db.Unscoped()).Where("id IN ?", ids).Find(&menus).Error; err != nil {
			return false, err
		}
	}
	return onlyGoods(menus), nil
}

type servedTimes struct {
	ReadyAt, ServedAt *time.Time
}

// グッズだけの注文は作るカップが無いので、常に提供済みにする（提供済みの時刻があれば残す）。
// グッズだけの注文に飲み物が加わったら、自動で付けた提供済みを外す。
// それ以外はクライアントの値をそのまま使う。
func resolveServedTimes(prevGoodsOnly, goodsOnly bool, prev, requested servedTimes, now time.Time) servedTimes {
	switch {
	case goodsOnly && prev.ServedAt != nil:
		if prev.ReadyAt == nil {
			prev.ReadyAt = prev.ServedAt
		}
		return prev
	case goodsOnly:
		return servedTimes{ReadyAt: &now, ServedAt: &now}
	case prevGoodsOnly:
		return servedTimes{}
	default:
		return requested
	}
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

// ブロードキャスト用のヘルパー
func (h *OrderHandler) broadcastOrders() {
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
		lines, err := loadOrderMenus(tx, order.ID, req.MenuIds, nil)
		if err != nil {
			return err
		}
		order.OrderMenus = lines
		goodsOnly, err := isGoodsOnly(tx, lines)
		if err != nil {
			return err
		}
		// 作成時はクライアントの ready_at / served_at を受け取らない
		times := resolveServedTimes(false, goodsOnly, servedTimes{}, servedTimes{}, order.CreatedAt)
		order.ReadyAt, order.ServedAt = times.ReadyAt, times.ServedAt
		return tx.Create(&order).Error
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

	err = h.db.Transaction(func(tx *gorm.DB) error {
		orderMenus, err := loadOrderMenus(tx, order.ID, req.MenuIds, order.OrderMenus)
		if err != nil {
			return err
		}
		prevGoodsOnly, err := isGoodsOnly(tx, order.OrderMenus)
		if err != nil {
			return err
		}
		goodsOnly, err := isGoodsOnly(tx, orderMenus)
		if err != nil {
			return err
		}
		times := resolveServedTimes(prevGoodsOnly, goodsOnly,
			servedTimes{ReadyAt: order.ReadyAt, ServedAt: order.ServedAt},
			servedTimes{ReadyAt: req.ReadyAt, ServedAt: req.ServedAt}, time.Now())
		if err := tx.Model(&order).Updates(map[string]any{
			"order_id":            req.OrderId,
			"ready_at":            times.ReadyAt,
			"served_at":           times.ServedAt,
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
			return tx.Create(&orderMenus).Error
		}
		return nil
	})
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errInvalidOrderMenus) {
			status = http.StatusBadRequest
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

	// 注文明細を削除
	if err := h.db.Where("order_id = ?", order.ID).Delete(&models.OrderMenu{}).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// オーダーを削除
	result := h.db.Delete(&models.Order{}, "id = ?", orderID)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Order deleted successfully"})
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
	if order.ReadyAt == nil {
		now := time.Now()
		order.ReadyAt = &now
	} else {
		order.ReadyAt = nil
	}

	if err := h.db.Save(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := preloadOrder(h.db).First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toOrderResponse(&order))
	h.broadcastOrders()
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

	if order.ServedAt == nil {
		now := time.Now()
		order.ServedAt = &now
		order.ReadyAt = &now
	} else {
		order.ServedAt = nil
		order.ReadyAt = nil
	}

	if err := h.db.Save(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if err := preloadOrder(h.db).First(&order, "id = ?", orderID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toOrderResponse(&order))
	h.broadcastOrders()
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}
