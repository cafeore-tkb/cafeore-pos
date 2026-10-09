// api/internal/handlers/items.go
package handlers

import (
	"log"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

type ItemHandler struct {
	db       *gorm.DB
	activity *notify.Activity
}

func NewItemHandler(db *gorm.DB, activity *notify.Activity) *ItemHandler {
	return &ItemHandler{db: db, activity: activity}
}

// DB models → API models 変換関数
func toItemResponse(item *models.Item) models.ItemResponse {
	resp := models.ItemResponse{
		Id:       openapi_types.UUID(item.ID),
		Name:     item.Name,
		Abbr:     item.Abbr,
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
		Name: req.Name,
		Abbr: req.Abbr,
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
	h.activity.Post(itemCreatedMessage(&item))
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
	// 通知で変更前と比べるため、タイプ込みで別に読んでおく（Save に関連を渡さないよう item とは分ける）。
	// 読めなかったら空と比べた誤った差分になるので、通知だけしない
	var before models.Item
	beforeErr := h.db.Preload("ItemType").First(&before, "id = ?", itemID).Error
	if beforeErr != nil {
		log.Printf("activity: failed to load item %s before update: %v", itemID, beforeErr)
	}

	// 更新
	item.Name = req.Name
	item.Abbr = req.Abbr

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
	if beforeErr == nil {
		h.activity.Post(itemUpdatedMessage(&before, &item))
	}
}

// DELETE /api/items/:id - アイテム削除
func (h *ItemHandler) DeleteItem(c *gin.Context) {
	id := c.Param("id")

	itemID, err := uuid.Parse(id)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	// アイテムは論理削除なので、使用量も行は消さずに今有効な行を閉じる。消す前の注文は消す前の使用量で数え続ける。
	// 先にアイテムを消して行を押さえ、同時の使用量の置き換え（ReplaceItemStockUsages）と重ならないようにする
	// 消した行は通知に名前を出すために RETURNING で受け取る
	var deleted models.Item
	var affected int64
	err = h.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.Returning{}).Delete(&deleted, "id = ?", itemID)
		if result.Error != nil {
			return result.Error
		}
		affected = result.RowsAffected
		return tx.Model(&models.ItemStockUsage{}).
			Where("item_id = ? AND valid_to IS NULL", itemID).
			Update("valid_to", time.Now()).Error
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if affected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Item not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Item deleted successfully"})
	h.activity.Post(itemDeletedMessage(&deleted))
}
