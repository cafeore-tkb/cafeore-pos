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
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
)

type OrderHandler struct {
	db        *gorm.DB
	hub       *Hub
	inventory *Inventory
}

func NewOrderHandler(db *gorm.DB, hub *Hub, inventory *Inventory) *OrderHandler {
	return &OrderHandler{db: db, hub: hub, inventory: inventory}
}

// 注文履歴では販売終了（論理削除）したメニューも参照する。
// 注文自体や販売用マスター一覧のスコープは変更しない。
func preloadOrder(db *gorm.DB) *gorm.DB {
	unscoped := func(db *gorm.DB) *gorm.DB { return db.Unscoped() }
	return db.
		Preload("OrderMenus.Menu", unscoped).
		Preload("OrderMenus.Menu.MenuItems.Item.ItemType").
		// カップは注文した順に並べ、後から削除した item・種類も表示できるようにする
		Preload("OrderCups", func(db *gorm.DB) *gorm.DB { return db.Order("order_cups.position") }).
		Preload("OrderCups.Item", unscoped).
		Preload("OrderCups.Item.ItemType", unscoped).
		Preload("Comments")
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

// 明細とカップを作る。existing は編集前の注文（新規作成では空の注文）。
func loadOrderMenus(db *gorm.DB, orderID uuid.UUID, requests []models.MenuInfoCreate, existing *models.Order) ([]models.OrderMenu, []models.OrderCup, error) {
	hasCups := make(map[uuid.UUID]bool, len(existing.OrderCups))
	for _, cup := range existing.OrderCups {
		hasCups[cup.OrderMenuID] = true
	}
	// ids は新しい明細のメニュー、legacyIDs はカップの無い既存の明細のメニュー
	var ids, legacyIDs []uuid.UUID
	for _, request := range requests {
		switch {
		case request.OrderMenuId == nil:
			ids = append(ids, uuid.UUID(request.MenuId))
		case !hasCups[uuid.UUID(*request.OrderMenuId)]:
			legacyIDs = append(legacyIDs, uuid.UUID(request.MenuId))
		}
	}
	var menus []models.Menu
	if len(ids) > 0 {
		if err := preloadMenu(db).Where("id IN ?", ids).Find(&menus).Error; err != nil {
			return nil, nil, err
		}
	}
	// 既存の明細のメニューは販売終了していてもカップに展開する
	if len(legacyIDs) > 0 {
		var legacyMenus []models.Menu
		if err := preloadMenu(db.Unscoped()).Where("id IN ?", legacyIDs).Find(&legacyMenus).Error; err != nil {
			return nil, nil, err
		}
		menus = append(menus, legacyMenus...)
	}
	lines, err := buildOrderMenus(orderID, requests, existing.OrderMenus, menus)
	if err != nil {
		return nil, nil, err
	}
	return lines, buildOrderCups(orderID, lines, existing, menus), nil
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
		Cups:              make([]models.OrderCupResponse, 0, len(order.OrderCups)),
	}
	for i := range order.OrderCups {
		resp.Cups = append(resp.Cups, toOrderCupResponse(&order.OrderCups[i]))
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

// 全オーダーを WSMessage にする。取得に失敗したら ok = false
func ordersMessage(db *gorm.DB) (WSMessage, bool) {
	var orders []models.Order
	if err := preloadOrder(db).Find(&orders).Error; err != nil {
		return WSMessage{}, false
	}
	responses := make([]models.OrderResponse, len(orders))
	for i, o := range orders {
		responses[i] = toOrderResponse(&o)
	}
	return WSMessage{
		Type:   WSMessageTypeOrders,
		Orders: responses,
	}, true
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
		lines, cups, err := loadOrderMenus(tx, order.ID, req.MenuIds, &models.Order{})
		if err != nil {
			return err
		}
		order.OrderMenus, order.OrderCups = lines, cups
		return tx.Create(&order).Error
	}); err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, errInvalidOrderMenus) {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	// 関連データをロードし、作った注文だけを配信する
	resp, err := publishOrder(h.db, h.hub, order.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, resp)
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

	// 明細が減ったときも閾値の記録を戻せるよう、変更前の分も見る。
	resourcesBefore := h.inventory.ResourceIDsForOrder(orderID)

	err = h.db.Transaction(func(tx *gorm.DB) error {
		// カップの状態変更と重なっても、どちらかの変更が消えないようにロックしてから読む
		order, err := lockOrder(tx, orderID)
		if err != nil {
			return err
		}
		orderMenus, orderCups, err := loadOrderMenus(tx, order.ID, req.MenuIds, &order)
		if err != nil {
			return err
		}
		// カップのある注文の状態はカップから決め直す。リクエストの ready_at / served_at は
		// 編集画面を開いた時点の値なので、使うとその間のカップの操作を巻き戻してしまう。
		// カップの無い注文（グッズだけの注文）だけリクエストの値を使う。
		order.OrderCups = orderCups
		order.ReadyAt, order.ServedAt = req.ReadyAt, req.ServedAt
		syncOrderWithCups(&order)
		if err := tx.Model(&models.Order{}).Where("id = ?", order.ID).Updates(map[string]any{
			"order_id":            req.OrderId,
			"ready_at":            order.ReadyAt,
			"served_at":           order.ServedAt,
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
		if err := tx.Where("order_id = ?", order.ID).Delete(&models.OrderCup{}).Error; err != nil {
			return err
		}
		if len(orderMenus) > 0 {
			if err := tx.Create(&orderMenus).Error; err != nil {
				return err
			}
		}
		// 引き継いだカップは同じ ID・状態のまま入れ直す
		if len(orderCups) > 0 {
			return tx.Omit(clause.Associations).Create(&orderCups).Error
		}
		return nil
	})
	if err != nil {
		status, message := http.StatusInternalServerError, err.Error()
		switch {
		case errors.Is(err, gorm.ErrRecordNotFound):
			status, message = http.StatusNotFound, "Order not found"
		case errors.Is(err, errInvalidOrderMenus):
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": message})
		return
	}

	resp, err := publishOrder(h.db, h.hub, orderID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, resp)
	go func() {
		h.inventory.CheckAlerts(mergeResourceIDs(resourcesBefore, h.inventory.ResourceIDsForOrder(orderID)))
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

	// 注文明細・カップ・オーダーをまとめて削除し、途中で失敗したら全部戻す
	var rowsAffected int64
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("order_id = ?", order.ID).Delete(&models.OrderMenu{}).Error; err != nil {
			return err
		}
		if err := tx.Where("order_id = ?", order.ID).Delete(&models.OrderCup{}).Error; err != nil {
			return err
		}
		result := tx.Delete(&models.Order{}, "id = ?", orderID)
		rowsAffected = result.RowsAffected
		return result.Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
		return
	}

	publishOrderDeleted(h.hub, orderID)
	c.JSON(http.StatusOK, gin.H{"message": "Order deleted successfully"})
	go h.inventory.CheckAlerts(resources)
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}
