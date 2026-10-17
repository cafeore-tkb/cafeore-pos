// api/internal/handlers/comment.go
package handlers

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type CommentHandler struct {
	db  *gorm.DB
	hub *Hub
}

func NewCommentHandler(db *gorm.DB, hub *Hub) *CommentHandler {
	return &CommentHandler{db: db, hub: hub}
}

func toCommentResponse(comment *models.Comment) models.CommentResponse {
	return models.CommentResponse{
		OrderId:   openapi_types.UUID(comment.OrderID),
		Author:    comment.Author,
		Text:      comment.Text,
		CreatedAt: comment.CreatedAt,
	}
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
	if err := h.db.Where("order_id = ?", orderUUID).Order("created_at DESC").Find(&comments).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// API型に変換
	responses := make([]models.CommentResponse, len(comments))
	for i, comment := range comments {
		responses[i] = toCommentResponse(&comment)
	}

	c.JSON(http.StatusOK, responses)
}

// POST /api/orders/:id/comments - コメント作成
func (h *CommentHandler) CreateComment(c *gin.Context) {
	orderID := c.Param("id")

	orderUUID, err := uuid.Parse(orderID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid order ID format"})
		return
	}

	var req models.CreateOrderCommentJSONRequestBody

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

	// コメントと監査ログを同じトランザクションで保存する。
	// ブラウザのイベント送信が途切れても、成功した返信を失わない。
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&comment).Error; err != nil {
			return err
		}
		details, err := json.Marshal(map[string]any{
			"orderId": orderUUID, "orderNo": order.OrderId,
			"author": comment.Author, "text": comment.Text,
		})
		if err != nil {
			return err
		}
		return tx.Create(&models.CaosOperation{
			ID: uuid.New(), Kind: "comment.created", Details: details,
			OccurredAt: comment.CreatedAt, RecordedAt: comment.CreatedAt, ContextAt: comment.CreatedAt,
		}).Error
	}); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toCommentResponse(&comment))
	_, _ = publishOrder(h.db, h.hub, orderUUID)
}
