// api/internal/handlers/items.go
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type ItemHandler struct {
	db *gorm.DB
}

func NewItemHandler(db *gorm.DB) *ItemHandler {
	return &ItemHandler{db: db}
}

// GET /api/items - アイテム一覧取得
func (h *ItemHandler) GetItems(c *gin.Context) {
	var items []models.Item
	if err := h.db.Preload("ItemType").Preload("MenuItems").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, items)
}

// POST /api/items - アイテム作成
func (h *ItemHandler) CreateItem(c *gin.Context) {
	var req struct {
		Name       string    `json:"name" binding:"required"`
		ItemTypeID uuid.UUID `json:"item_type_id" binding:"required"`
		Abbr       string    `json:"abbr" binding:"required"`
		Key        string    `json:"key" binding:"required"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// バリデーション
	if err := h.db.First(&models.ItemType{}, "id = ?", req.ItemTypeID).Error; err != nil {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": "invalid item_type_id",
		})
		return
	}

	item := models.Item{
		Name:       req.Name,
		ItemTypeID: req.ItemTypeID,
		Abbr:       req.Abbr,
		Key:        req.Key,
	}

	if err := h.db.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, item)
}

// GET /api/items/:id - アイテム取得
func (h *ItemHandler) GetItem(c *gin.Context) {
	id := c.Param("id")
	
	itemID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var item models.Item
	if err := h.db.First(&item, "id = ?", itemID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Item not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, item)
}

// PUT /api/items/:id - アイテム更新
func (h *ItemHandler) UpdateItem(c *gin.Context) {
	id := c.Param("id")
	
	itemID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var req struct {
		Name       string      `json:"name"`
		ItemTypeID uuid.UUID   `json:"item_type_id"`
		Abbr       string      `json:"abbr"`
		Key        string      `json:"key"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var item models.Item
	if err := h.db.First(&item, "id = ?", itemID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Item not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 更新
	if req.Name != "" {
		item.Name = req.Name
	}
	if req.ItemTypeID != uuid.Nil {
		item.ItemTypeID = req.ItemTypeID
	}
	if req.Abbr != "" {
		item.Abbr = req.Abbr
	}
	if req.Key != "" {
		item.Key = req.Key
	}

	if err := h.db.Save(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, item)
}

// DELETE /api/items/:id - アイテム削除
func (h *ItemHandler) DeleteItem(c *gin.Context) {
	id := c.Param("id")
	
	itemID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	result := h.db.Delete(&models.Item{}, "id = ?", itemID)
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
