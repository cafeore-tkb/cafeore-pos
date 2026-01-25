// api/internal/handlers/orders.go
package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type OrderHandler struct {
	db *gorm.DB
}

func NewOrderHandler(db *gorm.DB) *OrderHandler {
	return &OrderHandler{db: db}
}

// GET /api/orders - オーダー一覧取得
func (h *OrderHandler) GetOrders(c *gin.Context) {
	var orders []models.Order
	if err := h.db.Preload("Items").Preload("Comments").Find(&orders).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, orders)
}

// POST /api/orders - オーダー作成
func (h *OrderHandler) CreateOrder(c *gin.Context) {
	var req struct {
		OrderId           int         `json:"order_id" binding:"required"`
		BillingAmount     int         `json:"billing_amount" binding:"required"`
		Received          int         `json:"received"`
		DiscountOrderID   *uuid.UUID  `json:"discount_order_id"`
		DiscountOrderCups int         `json:"discount_order_cups"`
		ItemIDs           []uuid.UUID `json:"item_ids"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	order := models.Order{
		OrderId:           req.OrderId,
		CreatedAt:         time.Now(),
		BillingAmount:     req.BillingAmount,
		Received:          req.Received,
		DiscountOrderCups: req.DiscountOrderCups,
	}

	if req.DiscountOrderID != nil {
		order.DiscountOrderId = *req.DiscountOrderID
	}

	// アイテムの関連付け
	if len(req.ItemIDs) > 0 {
		var items []models.Item
		if err := h.db.Where("id IN ?", req.ItemIDs).Find(&items).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item IDs"})
			return
		}
		order.Items = items
	}

	if err := h.db.Create(&order).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 関連データをロード
	if err := h.db.Preload("Items").Preload("Comments").First(&order, "id = ?", order.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, order)
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
	if err := h.db.Preload("Items").Preload("Comments").First(&order, "id = ?", orderID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, order)
}

// PUT /api/orders/:id - オーダー更新
func (h *OrderHandler) UpdateOrder(c *gin.Context) {
	id := c.Param("id")

	orderID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var req struct {
		OrderId           *int        `json:"order_num"`
		ReadyAt           *time.Time  `json:"ready_at"`
		ServedAt          *time.Time  `json:"served_at"`
		BillingAmount     *int        `json:"billing_amount"`
		Received          *int        `json:"received"`
		DiscountOrderID   *uuid.UUID  `json:"discount_order_id"`
		DiscountOrderCups *int        `json:"discount_order_cups"`
		ItemIDs           []uuid.UUID `json:"item_ids"`
	}

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
	if req.OrderId != nil {
		order.OrderId = *req.OrderId
	}
	if req.ReadyAt != nil {
		order.ReadyAt = req.ReadyAt
	}
	if req.ServedAt != nil {
		order.ServedAt = req.ServedAt
	}
	if req.BillingAmount != nil {
		order.BillingAmount = *req.BillingAmount
	}
	if req.Received != nil {
		order.Received = *req.Received
	}
	if req.DiscountOrderID != nil {
		order.DiscountOrderId = *req.DiscountOrderID
	}
	if req.DiscountOrderCups != nil {
		order.DiscountOrderCups = *req.DiscountOrderCups
	}

	// アイテムの更新
	if len(req.ItemIDs) > 0 {
		var items []models.Item
		if err := h.db.Where("id IN ?", req.ItemIDs).Find(&items).Error; err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid item IDs"})
			return
		}
		// 既存の関連を削除して新しい関連を設定
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
	if err := h.db.Preload("Items").Preload("Comments").First(&order, "id = ?", order.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, order)
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

	c.JSON(http.StatusOK, order)
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

	c.JSON(http.StatusOK, order)
}
