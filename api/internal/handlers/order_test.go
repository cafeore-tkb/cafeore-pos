package handlers

import (
	"errors"
	"strings"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

func TestBuildOrderMenusSnapshotsNewLines(t *testing.T) {
	orderID, menuID := uuid.New(), uuid.New()
	requests := []models.MenuInfoCreate{{MenuId: menuID}, {MenuId: menuID}}
	lines, err := buildOrderMenus(orderID, requests, nil, []models.Menu{{ID: menuID, Name: "セット", Price: 0}})
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 || lines[0].ID == lines[1].ID || lines[0].ID == uuid.Nil {
		t.Fatalf("distinct order lines required: %+v", lines)
	}
	if lines[0].ID.String() >= lines[1].ID.String() {
		t.Fatalf("line IDs must follow the requested order: %+v", lines)
	}
	for _, line := range lines {
		if line.OrderID != orderID || line.MenuID != menuID || line.MenuName != "セット" || line.UnitPrice != 0 {
			t.Fatalf("incorrect snapshot: %+v", line)
		}
	}
}

func TestBuildOrderMenusPreservesExistingSnapshots(t *testing.T) {
	orderID, menuID, lineID := uuid.New(), uuid.New(), uuid.New()
	assignee := "担当者"
	old := models.OrderMenu{ID: lineID, OrderID: orderID, MenuID: menuID, MenuName: "注文時の名前", UnitPrice: 500}
	requests := []models.MenuInfoCreate{{MenuId: menuID, OrderMenuId: &lineID, Assignee: &assignee}, {MenuId: menuID}}
	master := models.Menu{ID: menuID, Name: "変更後の名前", Price: 800}
	lines, err := buildOrderMenus(orderID, requests, []models.OrderMenu{old}, []models.Menu{master})
	if err != nil {
		t.Fatal(err)
	}
	if lines[0].ID != lineID || lines[0].MenuName != old.MenuName || lines[0].UnitPrice != 500 || *lines[0].Assignee != assignee {
		t.Fatalf("existing snapshot changed: %+v", lines[0])
	}
	if lines[1].MenuName != master.Name || lines[1].UnitPrice != 800 {
		t.Fatalf("new line must use current master: %+v", lines[1])
	}
	// 論理削除したメニューも、既存明細の編集ではマスター取得なしで保持する。
	lines, err = buildOrderMenus(orderID, requests[:1], []models.OrderMenu{old}, nil)
	if err != nil || lines[0].UnitPrice != 500 {
		t.Fatalf("deleted menu's historical line lost: %+v, %v", lines, err)
	}
}

func TestBuildOrderMenusRejectsInvalidReferences(t *testing.T) {
	orderID, menuID, lineID, otherID := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	old := models.OrderMenu{ID: lineID, OrderID: orderID, MenuID: menuID, MenuName: "保存名", UnitPrice: 500}
	deleted := models.Menu{ID: menuID, DeletedAt: gorm.DeletedAt{Time: time.Now(), Valid: true}}
	cases := map[string][]models.MenuInfoCreate{
		"unknown line":     {{MenuId: menuID, OrderMenuId: &otherID}},
		"changed menu":     {{MenuId: otherID, OrderMenuId: &lineID}},
		"duplicate line":   {{MenuId: menuID, OrderMenuId: &lineID}, {MenuId: menuID, OrderMenuId: &lineID}},
		"deleted new menu": {{MenuId: menuID}},
		"unknown new menu": {{MenuId: otherID}},
	}
	for name, requests := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := buildOrderMenus(orderID, requests, []models.OrderMenu{old}, []models.Menu{deleted}); !errors.Is(err, errInvalidOrderMenus) {
				t.Fatalf("expected validation error, got %v", err)
			}
		})
	}
	if _, err := buildOrderMenus(otherID, []models.MenuInfoCreate{{MenuId: menuID, OrderMenuId: &lineID}}, []models.OrderMenu{old}, nil); !errors.Is(err, errInvalidOrderMenus) {
		t.Fatal("another order's line must not be reused")
	}
}

func TestOrderResponseIncludesSnapshotsAndDeletedMenu(t *testing.T) {
	line := models.OrderMenu{
		ID: uuid.New(), MenuName: "注文時の名前", UnitPrice: 500,
		Menu: models.Menu{ID: uuid.New(), Name: "現在の名前", Price: 800,
			DeletedAt: gorm.DeletedAt{Time: time.Now(), Valid: true},
			MenuItems: []models.MenuItem{{Quantity: 2, Item: models.Item{Name: "コーヒー"}}}},
	}
	response := toOrderResponse(&models.Order{OrderMenus: []models.OrderMenu{line}})
	got := response.Menus[0]
	if got.Id != line.ID || got.MenuName != line.MenuName || got.UnitPrice != 500 || got.Menu.Items[0].Quantity != 2 {
		t.Fatalf("missing snapshot or historical composition: %+v", got)
	}
	if toOrderResponse(&models.Order{}).Menus == nil {
		t.Fatal("empty menus must serialize as []")
	}
}

func TestPreloadOrderUnscopesOnlyHistoricalMenu(t *testing.T) {
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: "host=localhost dbname=unused", PreferSimpleProtocol: true}), &gorm.Config{DryRun: true, DisableAutomaticPing: true})
	if err != nil {
		t.Fatal(err)
	}
	query := preloadOrder(db)
	if query.Statement.Unscoped {
		t.Fatal("must not unscope the root order query")
	}
	scope := query.Statement.Preloads["OrderMenus.Menu"][0].(func(*gorm.DB) *gorm.DB)
	var menus []models.Menu
	historySQL := scope(db).Find(&menus).Statement.SQL.String()
	masterSQL := preloadMenu(db).Find(&menus).Statement.SQL.String()
	if strings.Contains(historySQL, "IS NULL") || !strings.Contains(masterSQL, "IS NULL") {
		t.Fatalf("history must include deleted menus but master list must not: %s / %s", historySQL, masterSQL)
	}
	if _, ok := query.Statement.Preloads["OrderMenus.Menu.MenuItems.Item.ItemType"]; !ok {
		t.Fatal("must preload menu composition")
	}
	lineScope := query.Statement.Preloads["OrderMenus"][0].(func(*gorm.DB) *gorm.DB)
	var lines []models.OrderMenu
	if lineSQL := lineScope(db).Find(&lines).Statement.SQL.String(); !strings.Contains(lineSQL, "ORDER BY order_menus.id") {
		t.Fatalf("lines must be ordered by line ID: %s", lineSQL)
	}
	cupScope := query.Statement.Preloads["OrderCups"][0].(func(*gorm.DB) *gorm.DB)
	var cups []models.OrderCup
	if cupSQL := cupScope(db).Find(&cups).Statement.SQL.String(); !strings.Contains(cupSQL, "ORDER BY order_cups.position") {
		t.Fatalf("cups must be ordered by position: %s", cupSQL)
	}
	itemScope := query.Statement.Preloads["OrderCups.Item"][0].(func(*gorm.DB) *gorm.DB)
	var items []models.Item
	if itemSQL := itemScope(db).Find(&items).Statement.SQL.String(); strings.Contains(itemSQL, "IS NULL") {
		t.Fatalf("cups must show deleted items: %s", itemSQL)
	}
}

func TestOrderResponseIncludesCups(t *testing.T) {
	served := time.Now()
	lineID, cupID := uuid.New(), uuid.New()
	item := models.Item{ID: uuid.New(), Name: "ブレンド", Abbr: "ブ", ItemType: models.ItemType{Name: "hot"}}
	response := toOrderResponse(&models.Order{OrderCups: []models.OrderCup{
		{ID: cupID, OrderMenuID: lineID, Item: item, ReadyAt: &served, ServedAt: &served},
		{ID: uuid.New(), OrderMenuID: lineID, Item: item},
	}})
	got := response.Cups[0]
	if got.Id != cupID || got.OrderMenuId != lineID || got.Item.Abbr != "ブ" || got.Item.ItemType.Name != "hot" {
		t.Fatalf("missing cup fields: %+v", got)
	}
	if !sameTime(got.ReadyAt, &served) || !sameTime(got.ServedAt, &served) {
		t.Fatalf("missing cup status: %+v", got)
	}
	if response.Cups[1].ReadyAt != nil || response.Cups[1].ServedAt != nil {
		t.Fatalf("preparing cup must have no timestamps: %+v", response.Cups[1])
	}
	if toOrderResponse(&models.Order{}).Cups == nil {
		t.Fatal("empty cups must serialize as []")
	}
}
