package handlers

import (
	"strings"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

func ptr[T any](v T) *T { return &v }

func TestPlanMasterImportCreatesAndResolvesByName(t *testing.T) {
	data := models.MasterData{
		ItemTypes: ptr([]models.MasterItemType{{Name: " hot ", DisplayName: "ホット"}}),
		Items:     ptr([]models.MasterItem{{Name: "ブレンド", Abbr: "ブ", ItemType: "hot"}}),
		Menus: ptr([]models.MasterMenu{{
			Key: "q", Name: "ブレンド", Abbr: "ブ", Price: 400,
			Items: []models.MasterMenuItem{{Item: "ブレンド", Quantity: 1}},
		}}),
	}
	p := planMasterImport(data, masterState{})
	if len(p.problems) > 0 {
		t.Fatal(p.problems)
	}
	if len(p.createItemTypes) != 1 || p.createItemTypes[0].Name != "hot" {
		t.Fatalf("item type must be created with trimmed name: %+v", p.createItemTypes)
	}
	// ファイル内で作るものどうしは、まだ無い ID でつながる。
	if p.createItems[0].ItemTypeID != p.createItemTypes[0].ID {
		t.Fatal("item must reference the item type created in the same file")
	}
	menu := p.createMenus[0]
	if menu.MenuItems[0].ItemID != p.createItems[0].ID || menu.MenuItems[0].MenuID != menu.ID {
		t.Fatalf("menu item references are wrong: %+v", menu.MenuItems)
	}
	want := models.MasterImportCount{Created: 1}
	if p.result.ItemTypes != want || p.result.Items != want || p.result.Menus != want {
		t.Fatalf("unexpected counts: %+v", p.result)
	}
}

func TestPlanMasterImportUpdatesOnlyChangedRows(t *testing.T) {
	hot := models.ItemType{ID: uuid.New(), Name: "hot", DisplayName: "ホット"}
	ice := models.ItemType{ID: uuid.New(), Name: "ice", DisplayName: "アイス"}
	blend := models.Item{ID: uuid.New(), Name: "ブレンド", Abbr: "ブ", ItemTypeID: hot.ID}
	iceBlend := models.Item{ID: uuid.New(), Name: "アイスブレンド", Abbr: "アブ", ItemTypeID: ice.ID}
	menu := models.Menu{ID: uuid.New(), Key: "q", Name: "ブレンド", Abbr: "ブ", Price: 400,
		MenuItems: []models.MenuItem{{ItemID: blend.ID, Quantity: 1}}}
	existing := masterState{
		itemTypes: []models.ItemType{hot, ice},
		items:     []models.Item{blend, iceBlend},
		menus:     []models.Menu{menu},
	}

	data := models.MasterData{
		ItemTypes: ptr([]models.MasterItemType{{Name: "hot", DisplayName: "ホット"}, {Name: "ice", DisplayName: "ICE"}}),
		// ファイルに無いアイテムタイプ（ice）も DB から引ける。
		Items: ptr([]models.MasterItem{{Name: "ブレンド", Abbr: "ブ", ItemType: "hot"}, {Name: "アイスブレンド", Abbr: "アブ", ItemType: "hot"}}),
		Menus: ptr([]models.MasterMenu{{Key: "q", Name: "ブレンド", Abbr: "ブ", Price: 400,
			Items: []models.MasterMenuItem{{Item: "ブレンド", Quantity: 1}}}}),
	}
	p := planMasterImport(data, existing)
	if len(p.problems) > 0 {
		t.Fatal(p.problems)
	}
	if p.result.ItemTypes != (models.MasterImportCount{Updated: 1, Unchanged: 1}) {
		t.Fatalf("item types: %+v", p.result.ItemTypes)
	}
	if p.result.Items != (models.MasterImportCount{Updated: 1, Unchanged: 1}) || p.updateItems[0].ItemTypeID != hot.ID {
		t.Fatalf("items: %+v %+v", p.result.Items, p.updateItems)
	}
	if p.result.Menus != (models.MasterImportCount{Unchanged: 1}) {
		t.Fatalf("menus: %+v", p.result.Menus)
	}

	// 数量だけ変えても更新になる。
	(*data.Menus)[0].Items[0].Quantity = 2
	p = planMasterImport(data, existing)
	if p.result.Menus != (models.MasterImportCount{Updated: 1}) || p.updateMenus[0].ID != menu.ID {
		t.Fatalf("quantity change must update the same menu: %+v", p.result.Menus)
	}
}

func TestPlanMasterImportRestoresDeletedMenuWithSameKey(t *testing.T) {
	hot := models.ItemType{ID: uuid.New(), Name: "hot"}
	blend := models.Item{ID: uuid.New(), Name: "ブレンド", ItemTypeID: hot.ID}
	deleted := models.Menu{ID: uuid.New(), Key: "q", Name: "ブレンド", Price: 400,
		MenuItems: []models.MenuItem{{ItemID: blend.ID, Quantity: 1}},
		DeletedAt: gorm.DeletedAt{Time: time.Now(), Valid: true}}
	data := models.MasterData{Menus: ptr([]models.MasterMenu{{Key: "q", Name: "ブレンド", Price: 400,
		Items: []models.MasterMenuItem{{Item: "ブレンド", Quantity: 1}}}})}

	p := planMasterImport(data, masterState{itemTypes: []models.ItemType{hot}, items: []models.Item{blend}, menus: []models.Menu{deleted}})
	if len(p.problems) > 0 {
		t.Fatal(p.problems)
	}
	// key には削除済みも含めた一意制約があるので、新しく作らずに同じ行を戻す。
	if len(p.createMenus) != 0 || len(p.updateMenus) != 1 || p.updateMenus[0].ID != deleted.ID {
		t.Fatalf("deleted menu must be restored in place: %+v", p)
	}
	if p.result.Menus != (models.MasterImportCount{Created: 1}) {
		t.Fatalf("restored menu counts as created: %+v", p.result.Menus)
	}
}

func TestPlanMasterImportReportsEveryProblem(t *testing.T) {
	dupA := models.Item{ID: uuid.New(), Name: "重複"}
	dupB := models.Item{ID: uuid.New(), Name: "重複"}
	data := models.MasterData{
		ItemTypes: ptr([]models.MasterItemType{{Name: "", DisplayName: "x"}, {Name: "hot", DisplayName: ""}}),
		Items: ptr([]models.MasterItem{
			{Name: "a", ItemType: "nope"},
			{Name: "a", ItemType: "nope"},
		}),
		Menus: ptr([]models.MasterMenu{
			{Key: "k", Name: "m", Items: []models.MasterMenuItem{{Item: "無い", Quantity: 1}, {Item: "重複", Quantity: 1}}},
			{Key: "k", Name: "m", Items: []models.MasterMenuItem{{Item: "a", Quantity: 1}}},
			{Key: "e", Name: "m"},
			{Key: "z", Name: "m", Items: []models.MasterMenuItem{{Item: "重複", Quantity: 0}}},
		}),
	}
	p := planMasterImport(data, masterState{items: []models.Item{dupA, dupB}})
	all := strings.Join(p.problems, "\n")
	for _, want := range []string{
		"アイテムタイプの 1 件目: name が空です",
		"アイテムタイプ「hot」: display_name が空です",
		"アイテム「a」: アイテムタイプ「nope」がありません",
		"アイテム「a」: 同じ name がファイル内に2回以上あります",
		"メニュー「k」: アイテム「無い」がありません",
		"メニュー「k」: アイテム「重複」が 2 件あり",
		"メニュー「k」: 同じ key がファイル内に2回以上あります",
		"メニュー「e」: items が空です",
		"メニュー「z」: アイテム「重複」の数量は1以上",
	} {
		if !strings.Contains(all, want) {
			t.Errorf("missing problem %q in:\n%s", want, all)
		}
	}
}

func TestPlanMasterImportRejectsAmbiguousExistingRows(t *testing.T) {
	a := models.ItemType{ID: uuid.New(), Name: "hot"}
	b := models.ItemType{ID: uuid.New(), Name: "hot"}
	data := models.MasterData{ItemTypes: ptr([]models.MasterItemType{{Name: "hot", DisplayName: "ホット"}})}
	p := planMasterImport(data, masterState{itemTypes: []models.ItemType{a, b}})
	if len(p.problems) != 1 || len(p.updateItemTypes) != 0 {
		t.Fatalf("ambiguous rows must not be updated: %+v", p)
	}
}

func TestSameMenuIgnoresItemOrder(t *testing.T) {
	x, y := uuid.New(), uuid.New()
	a := models.Menu{Name: "n", MenuItems: []models.MenuItem{{ItemID: x, Quantity: 1}, {ItemID: y, Quantity: 2}}}
	b := models.Menu{Name: "n", MenuItems: []models.MenuItem{{ItemID: y, Quantity: 2}, {ItemID: x, Quantity: 1}}}
	if !sameMenu(a, b) {
		t.Fatal("item order must not matter")
	}
	b.MenuItems[0].Quantity = 3
	if sameMenu(a, b) {
		t.Fatal("quantity difference must matter")
	}
}
