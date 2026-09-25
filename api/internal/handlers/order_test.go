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
		t.Fatalf("cups must be ordered by line ID: %s", lineSQL)
	}
}

func TestBuildOrderMenusPreservesCupStatus(t *testing.T) {
	orderID, menuID, lineID := uuid.New(), uuid.New(), uuid.New()
	ready, served := time.Now(), time.Now().Add(time.Minute)
	old := models.OrderMenu{ID: lineID, OrderID: orderID, MenuID: menuID, ReadyAt: &ready, ServedAt: &served}
	requests := []models.MenuInfoCreate{{MenuId: menuID, OrderMenuId: &lineID}, {MenuId: menuID}}
	lines, err := buildOrderMenus(orderID, requests, []models.OrderMenu{old}, []models.Menu{{ID: menuID}})
	if err != nil {
		t.Fatal(err)
	}
	if !sameTime(lines[0].ReadyAt, &ready) || !sameTime(lines[0].ServedAt, &served) {
		t.Fatalf("editing an order must keep cup status: %+v", lines[0])
	}
	if lines[1].ReadyAt != nil || lines[1].ServedAt != nil {
		t.Fatalf("new cup must start as preparing: %+v", lines[1])
	}
}

func TestOrderResponseIncludesCupStatus(t *testing.T) {
	served := time.Now()
	response := toOrderResponse(&models.Order{OrderMenus: []models.OrderMenu{{ReadyAt: &served, ServedAt: &served}, {}}})
	if !sameTime(response.Menus[0].ReadyAt, &served) || !sameTime(response.Menus[0].ServedAt, &served) {
		t.Fatalf("missing cup status: %+v", response.Menus[0])
	}
	if response.Menus[1].ReadyAt != nil || response.Menus[1].ServedAt != nil {
		t.Fatalf("preparing cup must have no timestamps: %+v", response.Menus[1])
	}
}
