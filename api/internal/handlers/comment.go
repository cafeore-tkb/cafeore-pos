// api/internal/handlers/comment.go
package handlers

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type CommentHandler struct {
	db *gorm.DB
}

func NewCommentHandler(db *gorm.DB) *CommentHandler {
	return &CommentHandler{db: db}
}

// GET /api/orders/:id/comments - 特定オーダーのコメント一覧取得
func (h *CommentHandler) GetOrderComments(c *gin.Context) {
	orderID := c.Param("id")

	orderUUID, err := uuid.Parse(orderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID format"})
		return
	}

	// オーダーが存在するか確認
	var order models.Order
	if err := h.db.First(&order, "id = ?", orderUUID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var comments []models.Comment
	if err := h.db.Where("id = ?", orderUUID).Order("created_at DESC").Find(&comments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, comments)
}

// POST /api/orders/:id/comments - コメント作成
func (h *CommentHandler) CreateComment(c *gin.Context) {
	orderID := c.Param("id")

	orderUUID, err := uuid.Parse(orderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID format"})
		return
	}

	var req struct {
		Author string `json:"author" binding:"required"`
		Text   string `json:"text" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// オーダーが存在するか確認
	var order models.Order
	if err := h.db.First(&order, "id = ?", orderUUID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Order not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	comment := models.Comment{
		OrderID:   orderUUID,
		Author:    req.Author,
		Text:      req.Text,
		CreatedAt: time.Now(),
	}

	if err := h.db.Create(&comment).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, comment)
}
