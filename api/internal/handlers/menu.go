package handlers

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	openapi_types "github.com/oapi-codegen/runtime/types"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
)

type MenuHandler struct {
	db *gorm.DB
}

func NewMenuHandler(db *gorm.DB) *MenuHandler {
	return &MenuHandler{db: db}
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

// 構成品の指定がおかしいときのエラー。これだけ 400 で文面を返し、DB のエラーは 500 にする。
type invalidMenuItemsError struct{ msg string }

func (e *invalidMenuItemsError) Error() string { return e.msg }

func buildMenuItems(menuID uuid.UUID, requests []models.MenuItemRequest) ([]models.MenuItem, error) {
	if len(requests) == 0 {
		return nil, &invalidMenuItemsError{"items is required"}
	}

	menuItems := make([]models.MenuItem, 0, len(requests))
	seen := make(map[uuid.UUID]struct{}, len(requests))
	for _, request := range requests {
		itemID := uuid.UUID(request.ItemId)
		if request.Quantity < 1 {
			return nil, &invalidMenuItemsError{"quantity must be greater than zero"}
		}
		if _, exists := seen[itemID]; exists {
			return nil, &invalidMenuItemsError{"duplicate item_id"}
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

// 存在しないアイテムを指していたら invalidMenuItemsError を返す。
// 確かめずに作ると外部キー違反の DB エラーになり、入力の誤りと見分けられない。
// 外部キーと同じ基準にするため、論理削除済みのアイテムも存在するものとして数える。
func ensureItemsExist(tx *gorm.DB, menuItems []models.MenuItem) error {
	ids := make([]uuid.UUID, 0, len(menuItems))
	for _, menuItem := range menuItems {
		ids = append(ids, menuItem.ItemID)
	}
	var count int64
	if err := tx.Unscoped().Model(&models.Item{}).Where("id IN ?", ids).Count(&count).Error; err != nil {
		return err
	}
	if count != int64(len(ids)) {
		return &invalidMenuItemsError{"item not found"}
	}
	return nil
}

// Postgres の一意制約違反のエラーコード
const pgUniqueViolation = "23505"

// トランザクションのエラーを、入力の誤りなら 400、それ以外は 500 で返す。
// key の重複（menus.key の一意制約）も入力の誤りとして 400 にする。
func respondMenuWriteError(c *gin.Context, err error) {
	var invalid *invalidMenuItemsError
	if errors.As(err, &invalid) {
		c.JSON(http.StatusBadRequest, gin.H{"error": invalid.Error()})
		return
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
		c.JSON(http.StatusBadRequest, gin.H{"error": "key already exists"})
		return
	}
	respondInternalError(c, err)
}

func (h *MenuHandler) GetMenus(c *gin.Context) {
	var menus []models.Menu
	if err := preloadMenu(h.db).Find(&menus).Error; err != nil {
		respondInternalError(c, err)
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
		respondInternalError(c, err)
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
		if err := ensureItemsExist(tx, menuItems); err != nil {
			return err
		}
		return tx.Create(&menuItems).Error
	}); err != nil {
		respondMenuWriteError(c, err)
		return
	}

	if err := preloadMenu(h.db).First(&menu, "id = ?", menu.ID).Error; err != nil {
		respondInternalError(c, err)
		return
	}
	c.JSON(http.StatusCreated, toMenuResponse(&menu))
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
		if err := ensureItemsExist(tx, menuItems); err != nil {
			return err
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
		respondMenuWriteError(c, err)
		return
	}

	if err := preloadMenu(h.db).First(&menu, "id = ?", menuID).Error; err != nil {
		respondInternalError(c, err)
		return
	}
	c.JSON(http.StatusOK, toMenuResponse(&menu))
}

func (h *MenuHandler) DeleteMenu(c *gin.Context) {
	menuID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid ID format"})
		return
	}

	result := h.db.Delete(&models.Menu{}, "id = ?", menuID)
	if result.Error != nil {
		respondInternalError(c, result.Error)
		return
	}
	if result.RowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Menu not found"})
		return
	}
	c.Status(http.StatusNoContent)
}
