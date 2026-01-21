// api/internal/handlers/item_types.go
package handlers

import (
	"net/http"

	"cafeore-pos/api/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
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

// PUT /api/item-types/:id - アイテムタイプ更新
func (h *ItemHandler) UpdateItemType(c *gin.Context) {
	id := c.Param("id")
	
	itemTypeID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var req struct {
		Name        string    `json:"name"`
		DisplayName string    `json:"display_name"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var itemType models.ItemType
	if err := h.db.First(&itemType, "id = ?", itemTypeID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Item not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 更新
	if req.Name != "" {
		itemType.Name = req.Name
	}
	if req.DisplayName != "" {
		itemType.DisplayName = req.DisplayName
	}

	if err := h.db.Save(&itemType).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, itemType)
}

// DELETE /api/item-types/:id - アイテムタイプ削除
func (h *ItemHandler) DeleteItemType(c *gin.Context) {
	id := c.Param("id")
	
	itemTypeID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	result := h.db.Delete(&models.ItemType{}, "id = ?", itemTypeID)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}

	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Item not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Item deleted successfully"})
}
