package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"cafeore-pos/api/internal/models"
)

// アイテムタイプ・アイテム・メニューをまとめて書き出し・取り込みする。
//
// 行どうしの参照は UUID ではなく、アイテムタイプとアイテムは name、メニューは key で書く。
// 手で書いたファイルや Excel の CSV をそのまま流せるようにするため。
type MasterDataHandler struct {
	db *gorm.DB
}

func NewMasterDataHandler(db *gorm.DB) *MasterDataHandler {
	return &MasterDataHandler{db: db}
}

// GET /api/master-data - 取り込みと同じ形式で書き出す
func (h *MasterDataHandler) ExportMasterData(c *gin.Context) {
	var itemTypes []models.ItemType
	if err := h.db.Order("name").Find(&itemTypes).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	// 論理削除したアイテムタイプを指しているアイテムも、名前は出せるようにする。
	var items []models.Item
	if err := h.db.Preload("ItemType", func(db *gorm.DB) *gorm.DB { return db.Unscoped() }).
		Order("name").Find(&items).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	var menus []models.Menu
	if err := h.db.Preload("MenuItems.Item", func(db *gorm.DB) *gorm.DB { return db.Unscoped() }).
		Order("key").Find(&menus).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	outTypes := make([]models.MasterItemType, len(itemTypes))
	for i, t := range itemTypes {
		outTypes[i] = models.MasterItemType{Name: t.Name, DisplayName: t.DisplayName}
	}
	outItems := make([]models.MasterItem, len(items))
	for i, item := range items {
		outItems[i] = models.MasterItem{Name: item.Name, Abbr: item.Abbr, ItemType: item.ItemType.Name}
	}
	outMenus := make([]models.MasterMenu, len(menus))
	for i, menu := range menus {
		menuItems := make([]models.MasterMenuItem, len(menu.MenuItems))
		for j, mi := range menu.MenuItems {
			menuItems[j] = models.MasterMenuItem{Item: mi.Item.Name, Quantity: mi.Quantity}
		}
		outMenus[i] = models.MasterMenu{Key: menu.Key, Name: menu.Name, Abbr: menu.Abbr, Price: menu.Price, Items: menuItems}
	}

	c.JSON(http.StatusOK, models.MasterData{ItemTypes: &outTypes, Items: &outItems, Menus: &outMenus})
}

// POST /api/master-data/import - 名前・キーで突き合わせて作成または更新する
//
// ファイルに無い行は消さない。1件でも不正があれば何も書き込まない。
func (h *MasterDataHandler) ImportMasterData(c *gin.Context) {
	h.importMasterData(c, false)
}

// POST /api/master-data/import/dry-run - 検証と件数の集計だけして書き込まない
func (h *MasterDataHandler) ImportMasterDataDryRun(c *gin.Context) {
	h.importMasterData(c, true)
}

func (h *MasterDataHandler) importMasterData(c *gin.Context, dryRun bool) {
	var req models.ImportMasterDataJSONRequestBody
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var plan *masterImportPlan
	err := h.db.Transaction(func(tx *gorm.DB) error {
		existing, err := loadMasterState(tx)
		if err != nil {
			return err
		}
		plan = planMasterImport(req, existing)
		if len(plan.problems) > 0 || dryRun {
			return nil
		}
		return plan.apply(tx)
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if len(plan.problems) > 0 {
		c.JSON(http.StatusBadRequest, models.MasterImportError{
			Error:    fmt.Sprintf("取り込めない行が %d 件あります", len(plan.problems)),
			Problems: plan.problems,
		})
		return
	}

	plan.result.DryRun = dryRun
	c.JSON(http.StatusOK, plan.result)
}

// 突き合わせに使う DB の現状。
type masterState struct {
	itemTypes []models.ItemType
	items     []models.Item
	// key には論理削除した行も含めた一意制約があるので、削除済みも持つ。
	menus []models.Menu
}

func loadMasterState(tx *gorm.DB) (masterState, error) {
	var s masterState
	if err := tx.Find(&s.itemTypes).Error; err != nil {
		return s, err
	}
	if err := tx.Find(&s.items).Error; err != nil {
		return s, err
	}
	if err := tx.Unscoped().Preload("MenuItems").Find(&s.menus).Error; err != nil {
		return s, err
	}
	return s, nil
}

type masterImportPlan struct {
	createItemTypes []models.ItemType
	updateItemTypes []models.ItemType
	createItems     []models.Item
	updateItems     []models.Item
	createMenus     []models.Menu
	// 論理削除されていたメニューの復元も含む
	updateMenus []models.Menu

	result   models.MasterImportResult
	problems []string
}

// ファイルの内容と DB の現状から、何を作り何を更新するかを決める。DB には触らない。
func planMasterImport(data models.MasterData, existing masterState) *masterImportPlan {
	p := &masterImportPlan{}
	problemf := func(format string, args ...any) {
		p.problems = append(p.problems, fmt.Sprintf(format, args...))
	}

	// --- アイテムタイプ ---
	liveTypeIDs := map[string][]uuid.UUID{}
	liveTypes := map[uuid.UUID]models.ItemType{}
	for _, t := range existing.itemTypes {
		liveTypeIDs[t.Name] = append(liveTypeIDs[t.Name], t.ID)
		liveTypes[t.ID] = t
	}
	typeIDByName := map[string]uuid.UUID{}
	seenTypes := map[string]bool{}
	for i, row := range deref(data.ItemTypes) {
		name, displayName := strings.TrimSpace(row.Name), strings.TrimSpace(row.DisplayName)
		label := rowLabel("アイテムタイプ", i, name)
		if name == "" {
			problemf("%s: name が空です", label)
			continue
		}
		if seenTypes[name] {
			problemf("%s: 同じ name がファイル内に2回以上あります", label)
			continue
		}
		seenTypes[name] = true
		if displayName == "" {
			problemf("%s: display_name が空です", label)
			continue
		}

		switch ids := liveTypeIDs[name]; len(ids) {
		case 0:
			t := models.ItemType{ID: uuid.New(), Name: name, DisplayName: displayName}
			p.createItemTypes = append(p.createItemTypes, t)
			p.result.ItemTypes.Created++
			typeIDByName[name] = t.ID
		case 1:
			t := liveTypes[ids[0]]
			typeIDByName[name] = t.ID
			if t.DisplayName == displayName {
				p.result.ItemTypes.Unchanged++
				continue
			}
			t.DisplayName = displayName
			p.updateItemTypes = append(p.updateItemTypes, t)
			p.result.ItemTypes.Updated++
		default:
			problemf("%s: 同じ name のアイテムタイプが既に %d 件あり、どれを更新するか決められません", label, len(ids))
		}
	}
	resolveType := func(name string) (uuid.UUID, string) {
		if id, ok := typeIDByName[name]; ok {
			return id, ""
		}
		switch ids := liveTypeIDs[name]; len(ids) {
		case 0:
			return uuid.Nil, fmt.Sprintf("アイテムタイプ「%s」がありません", name)
		case 1:
			return ids[0], ""
		default:
			return uuid.Nil, fmt.Sprintf("アイテムタイプ「%s」が %d 件あり、どれか決められません", name, len(ids))
		}
	}

	// --- アイテム ---
	liveItemIDs := map[string][]uuid.UUID{}
	liveItems := map[uuid.UUID]models.Item{}
	for _, item := range existing.items {
		liveItemIDs[item.Name] = append(liveItemIDs[item.Name], item.ID)
		liveItems[item.ID] = item
	}
	itemIDByName := map[string]uuid.UUID{}
	seenItems := map[string]bool{}
	for i, row := range deref(data.Items) {
		name, abbr, typeName := strings.TrimSpace(row.Name), strings.TrimSpace(row.Abbr), strings.TrimSpace(row.ItemType)
		label := rowLabel("アイテム", i, name)
		if name == "" {
			problemf("%s: name が空です", label)
			continue
		}
		if seenItems[name] {
			problemf("%s: 同じ name がファイル内に2回以上あります", label)
			continue
		}
		seenItems[name] = true
		if typeName == "" {
			problemf("%s: item_type が空です", label)
			continue
		}
		typeID, msg := resolveType(typeName)
		if msg != "" {
			problemf("%s: %s", label, msg)
			continue
		}

		switch ids := liveItemIDs[name]; len(ids) {
		case 0:
			item := models.Item{ID: uuid.New(), Name: name, Abbr: abbr, ItemTypeID: typeID}
			p.createItems = append(p.createItems, item)
			p.result.Items.Created++
			itemIDByName[name] = item.ID
		case 1:
			item := liveItems[ids[0]]
			itemIDByName[name] = item.ID
			if item.Abbr == abbr && item.ItemTypeID == typeID {
				p.result.Items.Unchanged++
				continue
			}
			item.Abbr, item.ItemTypeID = abbr, typeID
			p.updateItems = append(p.updateItems, item)
			p.result.Items.Updated++
		default:
			problemf("%s: 同じ name のアイテムが既に %d 件あり、どれを更新するか決められません", label, len(ids))
		}
	}
	resolveItem := func(name string) (uuid.UUID, string) {
		if id, ok := itemIDByName[name]; ok {
			return id, ""
		}
		switch ids := liveItemIDs[name]; len(ids) {
		case 0:
			return uuid.Nil, fmt.Sprintf("アイテム「%s」がありません", name)
		case 1:
			return ids[0], ""
		default:
			return uuid.Nil, fmt.Sprintf("アイテム「%s」が %d 件あり、どれか決められません", name, len(ids))
		}
	}

	// --- メニュー ---
	menuByKey := map[string]models.Menu{}
	for _, menu := range existing.menus {
		menuByKey[menu.Key] = menu
	}
	seenMenus := map[string]bool{}
	for i, row := range deref(data.Menus) {
		key, name, abbr := strings.TrimSpace(row.Key), strings.TrimSpace(row.Name), strings.TrimSpace(row.Abbr)
		label := rowLabel("メニュー", i, key)
		if key == "" {
			problemf("%s: key が空です", label)
			continue
		}
		if seenMenus[key] {
			problemf("%s: 同じ key がファイル内に2回以上あります", label)
			continue
		}
		seenMenus[key] = true
		if name == "" {
			problemf("%s: name が空です", label)
			continue
		}
		if len(row.Items) == 0 {
			problemf("%s: items が空です（アイテムを1つ以上入れてください）", label)
			continue
		}

		existingMenu, found := menuByKey[key]
		menuID := existingMenu.ID
		if !found {
			menuID = uuid.New()
		}
		menuItems := make([]models.MenuItem, 0, len(row.Items))
		seenMenuItems := map[uuid.UUID]bool{}
		ok := true
		for _, mi := range row.Items {
			itemName := strings.TrimSpace(mi.Item)
			if mi.Quantity < 1 {
				problemf("%s: アイテム「%s」の数量は1以上にしてください", label, itemName)
				ok = false
				continue
			}
			itemID, msg := resolveItem(itemName)
			if msg != "" {
				problemf("%s: %s", label, msg)
				ok = false
				continue
			}
			if seenMenuItems[itemID] {
				problemf("%s: アイテム「%s」が2回以上入っています（数量でまとめてください）", label, itemName)
				ok = false
				continue
			}
			seenMenuItems[itemID] = true
			menuItems = append(menuItems, models.MenuItem{MenuID: menuID, ItemID: itemID, Quantity: mi.Quantity})
		}
		if !ok {
			continue
		}

		menu := models.Menu{ID: menuID, Key: key, Name: name, Abbr: abbr, Price: row.Price, MenuItems: menuItems}
		switch {
		case !found:
			p.createMenus = append(p.createMenus, menu)
			p.result.Menus.Created++
		case existingMenu.DeletedAt.Valid:
			// 消したメニューを入れ直したときは、同じ key の行を生き返らせる。
			p.updateMenus = append(p.updateMenus, menu)
			p.result.Menus.Created++
		case sameMenu(existingMenu, menu):
			p.result.Menus.Unchanged++
		default:
			p.updateMenus = append(p.updateMenus, menu)
			p.result.Menus.Updated++
		}
	}

	return p
}

func (p *masterImportPlan) apply(tx *gorm.DB) error {
	if len(p.createItemTypes) > 0 {
		if err := tx.Create(&p.createItemTypes).Error; err != nil {
			return err
		}
	}
	for _, t := range p.updateItemTypes {
		if err := tx.Model(&models.ItemType{ID: t.ID}).Update("display_name", t.DisplayName).Error; err != nil {
			return err
		}
	}

	if len(p.createItems) > 0 {
		if err := tx.Omit(clause.Associations).Create(&p.createItems).Error; err != nil {
			return err
		}
	}
	for _, item := range p.updateItems {
		if err := tx.Model(&models.Item{ID: item.ID}).Updates(map[string]any{
			"abbr": item.Abbr, "item_type_id": item.ItemTypeID,
		}).Error; err != nil {
			return err
		}
	}

	for _, menu := range p.createMenus {
		if err := tx.Omit(clause.Associations).Create(&menu).Error; err != nil {
			return err
		}
		if err := tx.Omit(clause.Associations).Create(&menu.MenuItems).Error; err != nil {
			return err
		}
	}
	for _, menu := range p.updateMenus {
		result := tx.Unscoped().Model(&models.Menu{ID: menu.ID}).Updates(map[string]any{
			"name": menu.Name, "abbr": menu.Abbr, "price": menu.Price, "deleted_at": nil,
		})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			return errors.New("menu disappeared during import: " + menu.Key)
		}
		if err := tx.Where("menu_id = ?", menu.ID).Delete(&models.MenuItem{}).Error; err != nil {
			return err
		}
		if err := tx.Omit(clause.Associations).Create(&menu.MenuItems).Error; err != nil {
			return err
		}
	}
	return nil
}

func sameMenu(a, b models.Menu) bool {
	if a.Name != b.Name || a.Abbr != b.Abbr || a.Price != b.Price || len(a.MenuItems) != len(b.MenuItems) {
		return false
	}
	quantities := make(map[uuid.UUID]int, len(a.MenuItems))
	for _, mi := range a.MenuItems {
		quantities[mi.ItemID] = mi.Quantity
	}
	for _, mi := range b.MenuItems {
		if q, ok := quantities[mi.ItemID]; !ok || q != mi.Quantity {
			return false
		}
	}
	return true
}

// エラーで指す行の呼び方。名前があれば名前、無ければ何件目か。
func rowLabel(kind string, index int, name string) string {
	if name == "" {
		return fmt.Sprintf("%sの %d 件目", kind, index+1)
	}
	return fmt.Sprintf("%s「%s」", kind, name)
}

func deref[T any](s *[]T) []T {
	if s == nil {
		return nil
	}
	return *s
}
