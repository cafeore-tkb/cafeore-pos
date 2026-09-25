package handlers

import (
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
)

func testItem(typeName string) models.Item {
	return models.Item{ID: uuid.New(), Name: typeName, Abbr: typeName, ItemType: models.ItemType{ID: uuid.New(), Name: typeName}}
}

func testMenu(items ...models.MenuItem) models.Menu {
	menu := models.Menu{ID: uuid.New(), Name: "セット"}
	for _, item := range items {
		item.MenuID, item.ItemID = menu.ID, item.Item.ID
		menu.MenuItems = append(menu.MenuItems, item)
	}
	return menu
}

// 新規作成の明細からカップを作る
func newOrderCups(t *testing.T, orderID uuid.UUID, menus ...models.Menu) ([]models.OrderMenu, []models.OrderCup) {
	t.Helper()
	requests := make([]models.MenuInfoCreate, len(menus))
	for i, menu := range menus {
		requests[i] = models.MenuInfoCreate{MenuId: menu.ID}
	}
	lines, err := buildOrderMenus(orderID, requests, nil, menus)
	if err != nil {
		t.Fatal(err)
	}
	return lines, buildOrderCups(orderID, lines, nil, nil, menus)
}

func TestBuildOrderCupsExpandsQuantityAndSkipsGoods(t *testing.T) {
	orderID := uuid.New()
	hot, ice, goods := testItem("hot"), testItem("ice"), testItem("others")
	set := testMenu(models.MenuItem{Item: hot, Quantity: 2}, models.MenuItem{Item: goods, Quantity: 1}, models.MenuItem{Item: ice, Quantity: 1})
	goodsOnly := testMenu(models.MenuItem{Item: goods, Quantity: 3})
	lines, cups := newOrderCups(t, orderID, set, goodsOnly, set)

	want := []struct {
		line int
		item uuid.UUID
	}{{0, hot.ID}, {0, hot.ID}, {0, ice.ID}, {2, hot.ID}, {2, hot.ID}, {2, ice.ID}}
	if len(cups) != len(want) {
		t.Fatalf("expected %d cups, got %+v", len(want), cups)
	}
	seen := map[uuid.UUID]bool{}
	for i, w := range want {
		cup := cups[i]
		if cup.OrderID != orderID || cup.OrderMenuID != lines[w.line].ID || cup.ItemID != w.item || cup.Position != i {
			t.Fatalf("cup %d: %+v", i, cup)
		}
		if cup.ReadyAt != nil || cup.ServedAt != nil || cup.ID == uuid.Nil || seen[cup.ID] {
			t.Fatalf("cup %d must be a new preparing cup: %+v", i, cup)
		}
		seen[cup.ID] = true
	}
}

func TestTwoCupSetTogglesEachCup(t *testing.T) {
	hot := testItem("hot")
	set := testMenu(models.MenuItem{Item: hot, Quantity: 2})
	_, cups := newOrderCups(t, uuid.New(), set)
	order := &models.Order{OrderCups: cups}
	t1, t2 := time.Now(), time.Now().Add(time.Minute)

	toggleCupServed(order, &order.OrderCups[0], t1)
	if cupStates(order) != "sp" || order.ServedAt != nil {
		t.Fatalf("serving one cup of a set must not serve the other: %s %+v", cupStates(order), order)
	}
	toggleCupServed(order, &order.OrderCups[1], t2)
	if cupStates(order) != "ss" || !sameTime(order.ServedAt, &t2) {
		t.Fatalf("the order must be served with both cups: %s %+v", cupStates(order), order)
	}
	toggleCupServed(order, &order.OrderCups[1], t2)
	if cupStates(order) != "sp" || order.ServedAt != nil {
		t.Fatalf("unserving one cup must keep the other: %s %+v", cupStates(order), order)
	}
}

func TestSetWithGoodsIsServedWhenAllVisibleCupsAreServed(t *testing.T) {
	set := testMenu(models.MenuItem{Item: testItem("hot"), Quantity: 1}, models.MenuItem{Item: testItem("others"), Quantity: 1})
	goods := testMenu(models.MenuItem{Item: testItem("others"), Quantity: 1})
	_, cups := newOrderCups(t, uuid.New(), set, goods)
	order := &models.Order{OrderCups: cups}
	now := time.Now()
	if len(cups) != 1 {
		t.Fatalf("goods must not be cups: %+v", cups)
	}
	toggleCupReady(order, &order.OrderCups[0], now)
	if !sameTime(order.ReadyAt, &now) {
		t.Fatalf("the order must be ready once its only cup is ready: %+v", order)
	}
	toggleCupServed(order, &order.OrderCups[0], now)
	if !sameTime(order.ServedAt, &now) {
		t.Fatalf("the order must be served once its only cup is served: %+v", order)
	}
}

func TestGoodsOnlyOrderHasNoCups(t *testing.T) {
	goods := testMenu(models.MenuItem{Item: testItem("others"), Quantity: 2})
	_, cups := newOrderCups(t, uuid.New(), goods)
	if len(cups) != 0 {
		t.Fatalf("goods-only order must have no cups: %+v", cups)
	}
	order := &models.Order{OrderCups: cups}
	if findOrderCup(order, uuid.New()) != nil {
		t.Fatal("cup operations must not apply to a goods-only order")
	}
	now := time.Now()
	toggleOrderServed(order, now)
	if !sameTime(order.ServedAt, &now) {
		t.Fatalf("goods-only order is served by the order-level operation: %+v", order)
	}
}

func TestBuildOrderCupsKeepsCupsOfExistingLines(t *testing.T) {
	orderID := uuid.New()
	hot, ice := testItem("hot"), testItem("ice")
	set := testMenu(models.MenuItem{Item: hot, Quantity: 2})
	single := testMenu(models.MenuItem{Item: ice, Quantity: 1})
	lines, cups := newOrderCups(t, orderID, set, single)
	t1 := time.Now()
	cups[1].ReadyAt, cups[1].ServedAt = &t1, &t1
	cups[2].ReadyAt = &t1
	cups[0].Item = hot // 読み込んだ item は保存し直さない

	// 注文後にセットの構成が変わっても、既存の明細のカップはそのまま
	set.MenuItems[0].Quantity = 3
	requests := []models.MenuInfoCreate{
		{MenuId: set.ID, OrderMenuId: &lines[0].ID},
		{MenuId: single.ID},
	}
	newLines, err := buildOrderMenus(orderID, requests, lines, []models.Menu{single})
	if err != nil {
		t.Fatal(err)
	}
	got := buildOrderCups(orderID, newLines, lines, cups, []models.Menu{single})

	if len(got) != 3 {
		t.Fatalf("expected the 2 kept cups and 1 new cup, got %+v", got)
	}
	for i := range 2 {
		if got[i].ID != cups[i].ID || got[i].OrderMenuID != lines[0].ID || got[i].Position != i {
			t.Fatalf("kept cup %d changed: %+v", i, got[i])
		}
		if got[i].Item.ID != uuid.Nil {
			t.Fatalf("kept cup %d must not carry the loaded item: %+v", i, got[i])
		}
	}
	if got[0].ReadyAt != nil || !sameTime(got[1].ServedAt, &t1) || !sameTime(got[1].ReadyAt, &t1) {
		t.Fatalf("kept cups must keep their status: %+v", got[:2])
	}
	// 削除した明細のカップは消え、追加した明細のカップは準備中で作られる
	if got[2].OrderMenuID != newLines[1].ID || got[2].ID == cups[2].ID || got[2].ReadyAt != nil || got[2].Position != 2 {
		t.Fatalf("new line must get a new preparing cup: %+v", got[2])
	}
}

func TestBuildOrderCupsReordersKeptCups(t *testing.T) {
	orderID := uuid.New()
	a := testMenu(models.MenuItem{Item: testItem("hot"), Quantity: 1})
	b := testMenu(models.MenuItem{Item: testItem("ice"), Quantity: 1})
	lines, cups := newOrderCups(t, orderID, a, b)
	requests := []models.MenuInfoCreate{
		{MenuId: b.ID, OrderMenuId: &lines[1].ID},
		{MenuId: a.ID, OrderMenuId: &lines[0].ID},
	}
	newLines, err := buildOrderMenus(orderID, requests, lines, nil)
	if err != nil {
		t.Fatal(err)
	}
	got := buildOrderCups(orderID, newLines, lines, cups, nil)
	if len(got) != 2 || got[0].ID != cups[1].ID || got[1].ID != cups[0].ID || got[0].Position != 0 || got[1].Position != 1 {
		t.Fatalf("cups must follow the line order: %+v", got)
	}
}
