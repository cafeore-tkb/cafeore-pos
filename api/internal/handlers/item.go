// api/internal/handlers/items.go
package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type ItemHandler struct {
	db *gorm.DB
}

func NewItemHandler(db *gorm.DB) *ItemHandler {
	return &ItemHandler{db: db}
}

// DB models → API models 変換関数
func toItemResponse(item *models.Item) models.ItemResponse {
	resp := models.ItemResponse{
		Id: openapi_types.UUID(item.ID),
		Name: item.Name,
		Abbr: item.Abbr,
		Price: item.Price,
		Key:  item.Key,
		ItemType: toItemTypeResponse(&item.ItemType),
	}
	return resp
}

// GET /api/items - アイテム一覧取得
func (h *ItemHandler) GetItems(c *gin.Context) {
	var items []models.Item
	if err := h.db.Preload("ItemType").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// API型に変換
	responses := make([]models.ItemResponse, len(items))
	for i, item := range items {
		responses[i] = toItemResponse(&item)
	}

	c.JSON(http.StatusOK, responses)
}

// POST /api/items - アイテム作成
func (h *ItemHandler) CreateItem(c *gin.Context) {
	var req models.CreateItemJSONRequestBody

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// API型 → DB型に変換
	item := models.Item{
		Name:     req.Name,
		Abbr:     req.Abbr,
		Price:    req.Price,
		Key:      req.Key,
	}

	// タイプの関連付け
	itemTypeID, err := uuid.Parse(req.ItemTypeId.String())
	if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid itemType ID format"})
			return
	}
	item.ItemTypeID = itemTypeID

	if err := h.db.Create(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 関連データをロード
	if err := h.db.Preload("ItemType").First(&item, "id = ?", item.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toItemResponse(&item))
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
	if err := h.db.Preload("ItemType").First(&item, "id = ?", itemID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "Item not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toItemResponse(&item))
}

// PUT /api/items/:id - アイテム更新
func (h *ItemHandler) UpdateItem(c *gin.Context) {
	id := c.Param("id")
	
	itemID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var req models.UpdateItemJSONRequestBody

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
	item.Name = req.Name
	item.Abbr = req.Abbr
	item.Price = req.Price
	item.Key = req.Key

	// タイプの更新
	itemTypeID, err := uuid.Parse(req.ItemTypeId.String())

	if err != nil {
    c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid itemType ID format"})
    return
	}
	item.ItemTypeID = itemTypeID

	if err := h.db.Save(&item).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 更新後のデータをロード
	if err := h.db.Preload("ItemType").First(&item, "id = ?", item.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toItemResponse(&item))
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
