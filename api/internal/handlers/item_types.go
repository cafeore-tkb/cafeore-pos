// api/internal/handlers/item_types.go
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type ItemTypeHandler struct {
	db *gorm.DB
}

func NewItemTypeHandler(db *gorm.DB) *ItemTypeHandler {
	return &ItemTypeHandler{db: db}
}

// GET /api/item-types - ItemType一覧取得
func (h *ItemTypeHandler) GetItemTypes(c *gin.Context) {
	var itemTypes []models.ItemType
	if err := h.db.Order("name").Find(&itemTypes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, itemTypes)
}

// POST /api/item-types - ItemType作成
func (h *ItemTypeHandler) CreateItemType(c *gin.Context) {
	var req struct {
		Name        string    `json:"name" binding:"required"`
		DisplayName string    `json:"display_name" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	item_type := models.ItemType{
		Name:        req.Name,
		DisplayName: req.DisplayName,
	}

	if err := h.db.Create(&item_type).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, item_type)
}

