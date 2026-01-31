// api/internal/handlers/item_type.go
package handlers

import (
	"net/http"

	"cafeore-pos/api/internal/models"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"
)

type ItemTypeHandler struct {
	db *gorm.DB
}

func NewItemTypeHandler(db *gorm.DB) *ItemTypeHandler {
	return &ItemTypeHandler{db: db}
}

func toItemTypeResponse(itemType *models.ItemType) models.ItemTypeResponse {
	return models.ItemTypeResponse{
		Id:          openapi_types.UUID(itemType.ID),
		Name:        itemType.Name,
		DisplayName: itemType.DisplayName,
	}
}

// GET /api/item-types - ItemType一覧取得
func (h *ItemTypeHandler) GetItemTypes(c *gin.Context) {
	var itemTypes []models.ItemType
	if err := h.db.Order("name").Find(&itemTypes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// API型に変換
	responses := make([]models.ItemTypeResponse, len(itemTypes))
	for i, itemType := range itemTypes {
		responses[i] = toItemTypeResponse(&itemType)
	}

	c.JSON(http.StatusOK, responses)
}

// POST /api/item-types - ItemType作成
func (h *ItemTypeHandler) CreateItemType(c *gin.Context) {
	var req models.CreateItemTypeJSONRequestBody

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	itemType := models.ItemType{
		Name:        req.Name,
		DisplayName: req.DisplayName,
	}

	if err := h.db.Create(&itemType).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusCreated, toItemTypeResponse(&itemType))
}

// GET /api/item-types/:id - idからアイテムタイプ取得
func (h *ItemTypeHandler) GetItemType(c *gin.Context) {
	id := c.Param("id")
	
	itemTypeID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var itemType models.ItemType
	if err := h.db.First(&itemType, "id = ?", itemTypeID).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "ItemType not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toItemTypeResponse(&itemType))
}

// PUT /api/item-types/:id - アイテムタイプ更新
func (h *ItemTypeHandler) UpdateItemType(c *gin.Context) {
	id := c.Param("id")
	
	itemTypeID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var req models.ItemTypeUpdateRequest

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
	itemType.Name = req.Name
	itemType.DisplayName = req.DisplayName

	if err := h.db.Save(&itemType).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 更新後のデータをロード
	if err := h.db.First(&itemType, "id = ?", itemType.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, toItemTypeResponse(&itemType))
}

// DELETE /api/item-types/:id - アイテムタイプ削除
func (h *ItemTypeHandler) DeleteItemType(c *gin.Context) {
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
