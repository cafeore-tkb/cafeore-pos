package handlers

import (
	"errors"
	"log"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

type MenuHandler struct {
	db       *gorm.DB
	activity *notify.Activity
}

func NewMenuHandler(db *gorm.DB, activity *notify.Activity) *MenuHandler {
	return &MenuHandler{db: db, activity: activity}
}

func toMenuResponse(menu *models.Menu) models.MenuResponse {
	items := make([]models.MenuItemResponse, 0, len(menu.MenuItems))
	for _, menuItem := range menu.MenuItems {
		items = append(items, models.MenuItemResponse{
			Item:     toItemResponse(&menuItem.Item),
			Quantity: menuItem.Quantity,
		})
	}

	return models.MenuResponse{
		Id:    openapi_types.UUID(menu.ID),
		Name:  menu.Name,
		Abbr:  menu.Abbr,
		Price: menu.Price,
		Key:   menu.Key,
		Items: items,
	}
}

func preloadMenu(db *gorm.DB) *gorm.DB {
	return db.Preload("MenuItems.Item.ItemType")
}

func buildMenuItems(menuID uuid.UUID, requests []models.MenuItemRequest) ([]models.MenuItem, error) {
	if len(requests) == 0 {
		return nil, errors.New("items is required")
	}

	menuItems := make([]models.MenuItem, 0, len(requests))
	seen := make(map[uuid.UUID]struct{}, len(requests))
	for _, request := range requests {
		itemID := uuid.UUID(request.ItemId)
		if request.Quantity < 1 {
			return nil, errors.New("quantity must be greater than zero")
		}
		if _, exists := seen[itemID]; exists {
			return nil, errors.New("duplicate item_id")
		}
		seen[itemID] = struct{}{}
		menuItems = append(menuItems, models.MenuItem{
			MenuID:   menuID,
			ItemID:   itemID,
			Quantity: request.Quantity,
		})
	}
	return menuItems, nil
}

func (h *MenuHandler) GetMenus(c *gin.Context) {
	var menus []models.Menu
	if err := preloadMenu(h.db).Find(&menus).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	responses := make([]models.MenuResponse, len(menus))
	for i := range menus {
		responses[i] = toMenuResponse(&menus[i])
	}
	c.JSON(http.StatusOK, responses)
}

func (h *MenuHandler) GetMenu(c *gin.Context) {
	menuID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var menu models.Menu
	if err := preloadMenu(h.db).First(&menu, "id = ?", menuID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Menu not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toMenuResponse(&menu))
}

func (h *MenuHandler) CreateMenu(c *gin.Context) {
	var request models.CreateMenuJSONRequestBody
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	menu := models.Menu{Name: request.Name, Abbr: request.Abbr, Price: request.Price, Key: request.Key}
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&menu).Error; err != nil {
			return err
		}
		menuItems, err := buildMenuItems(menu.ID, request.Items)
		if err != nil {
			return err
		}
		return tx.Create(&menuItems).Error
	}); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := preloadMenu(h.db).First(&menu, "id = ?", menu.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusCreated, toMenuResponse(&menu))
	h.activity.Post(menuCreatedMessage(&menu))
}

func (h *MenuHandler) UpdateMenu(c *gin.Context) {
	menuID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	var request models.UpdateMenuJSONRequestBody
	if err := c.ShouldBindJSON(&request); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	menuItems, err := buildMenuItems(menuID, request.Items)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 通知で変更前と比べるために読んでおく。読めなかったら空と比べた誤った差分になるので、通知だけしない
	var before models.Menu
	beforeErr := preloadMenu(h.db).First(&before, "id = ?", menuID).Error
	if beforeErr != nil {
		log.Printf("activity: failed to load menu %s before update: %v", menuID, beforeErr)
	}

	menu := models.Menu{ID: menuID}
	if err := h.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&menu).Updates(map[string]any{
			"name": request.Name, "abbr": request.Abbr, "price": request.Price, "key": request.Key,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return gorm.ErrRecordNotFound
		}
		if err := tx.Where("menu_id = ?", menuID).Delete(&models.MenuItem{}).Error; err != nil {
			return err
		}
		return tx.Create(&menuItems).Error
	}); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "Menu not found"})
			return
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := preloadMenu(h.db).First(&menu, "id = ?", menuID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toMenuResponse(&menu))
	if beforeErr == nil {
		h.activity.Post(menuUpdatedMessage(&before, &menu))
	}
}

func (h *MenuHandler) DeleteMenu(c *gin.Context) {
	menuID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	// 消した行は通知に名前を出すために RETURNING で受け取る
	var deleted models.Menu
	result := h.db.Clauses(clause.Returning{}).Delete(&deleted, "id = ?", menuID)
	if result.Error != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": result.Error.Error()})
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Menu not found"})
		return
	}
	c.Status(http.StatusNoContent)
	h.activity.Post(menuDeletedMessage(&deleted))
}
