// api/internal/handlers/orders.go
package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type OrderHandler struct {
	db *gorm.DB
}

func NewOrderHandler(db *gorm.DB) *OrderHandler {
	return &OrderHandler{db: db}
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
		DiscountOrderId:   (*openapi_types.UUID)(&order.DiscountOrderId),
		DiscountOrderCups: &order.DiscountOrderCups,
	}
	// Items変換
	if len(order.Items) > 0 {
		items := make([]models.ItemResponse, len(order.Items))
		for i, item := range order.Items {
			items[i] = toItemResponse(&item)
		}
		resp.Items = items
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

// GET /api/orders - オーダー一覧取得
func (h *OrderHandler) GetOrders(c *gin.Context) {
	var orders []models.Order
	if err := h.db.Preload("Items.ItemType").Preload("Comments").Find(&orders).Error; err != nil {
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
		OrderId:           req.OrderId,
		CreatedAt:         time.Now(),
		BillingAmount:     req.BillingAmount,
		Received:          req.Received,
		DiscountOrderCups: 0,
	}

	if req.DiscountOrderId != nil {
		order.DiscountOrderId = uuid.UUID(*req.DiscountOrderId)
	}

	if req.DiscountOrderCups != nil {
		order.DiscountOrderCups = *req.DiscountOrderCups
	}

	// アイテムの関連付け
	if len(req.Items) > 0 {
		itemIDs := make([]uuid.UUID, len(req.Items))
		for i, item := range req.Items {
			itemIDs[i] = uuid.UUID(item.Id)
		}

		var items []models.Item
		if err := h.db.Where("id IN ?", itemIDs).Find(&items).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item IDs"})
			return
		}
		order.Items = items
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

	if err := h.db.Create(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 関連データをロード
	if err := h.db.Preload("Items.ItemType").Preload("Comments").First(&order, "id = ?", order.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toOrderResponse(&order))
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
	if err := h.db.Preload("Items.ItemType").Preload("Comments").First(&order, "id = ?", orderID).Error; err != nil {
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
	if err := h.db.Preload("Items").First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 更新
	order.OrderId = req.OrderId
	order.ReadyAt = req.ReadyAt
	order.ServedAt = req.ServedAt
	order.BillingAmount = req.BillingAmount
	order.Received = req.Received

	if req.DiscountOrderId != nil {
		order.DiscountOrderId = uuid.UUID(*req.DiscountOrderId)
	}

	if req.DiscountOrderCups != nil {
		order.DiscountOrderCups = *req.DiscountOrderCups
	}

	// アイテムの更新
	if len(req.Items) > 0 {
		itemIDs := make([]uuid.UUID, len(req.Items))
		for i, item := range req.Items {
			itemIDs[i] = uuid.UUID(item.Id)
		}

		var items []models.Item
		if err := h.db.Where("id IN ?", itemIDs).Find(&items).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item IDs"})
			return
		}

		if err := h.db.Model(&order).Association("Items").Replace(items); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	if err := h.db.Save(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 更新後のデータをロード
	if err := h.db.Preload("Items.ItemType").Preload("Comments").First(&order, "id = ?", order.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toOrderResponse(&order))
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
	if err := h.db.Preload("Items").First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// many2many の関連を削除
	if err := h.db.Model(&order).Association("Items").Clear(); err != nil {
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
	now := time.Now()
	order.ReadyAt = &now

	if err := h.db.Save(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toOrderResponse(&order))
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

	now := time.Now()
	order.ServedAt = &now

	if err := h.db.Save(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toOrderResponse(&order))
}
