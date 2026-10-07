package handlers

import (
	"context"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

// 在庫の消費を本物の Postgres で数える（inventory.go の orderItemsSQL）。INVENTORY_TEST_DATABASE_URL を渡したときだけ動く
// （空の DB を渡すこと。表を空にする）。
//
//	INVENTORY_TEST_DATABASE_URL=postgres://postgres@localhost:55432/inventory_test go test ./internal/handlers/ -run Inventory

type inventoryEnv struct {
	t   *testing.T
	db  *gorm.DB
	inv *Inventory
}

func newInventoryEnv(t *testing.T) *inventoryEnv {
	t.Helper()
	dsn := os.Getenv("INVENTORY_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("INVENTORY_TEST_DATABASE_URL がないので、DB を使うテストは飛ばす")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	e := &inventoryEnv{t: t, db: db, inv: NewInventory(db, notify.NewSlack(""), RemindAuth{}, "")}
	e.must(db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error)
	e.must(db.AutoMigrate(&models.ItemType{}, &models.Item{}, &models.Menu{}, &models.MenuItem{}, &models.Order{}, &models.Comment{},
		&models.OrderMenu{}, &models.OrderCup{}, &models.StockResource{}, &models.ItemStockUsage{}, &models.StockEvent{}))
	e.must(db.Exec("TRUNCATE order_cups, order_menus, comments, orders, menu_items, menus, items, item_types, stock_events, item_stock_usages, stock_resources").Error)
	return e
}

func (e *inventoryEnv) must(err error) {
	e.t.Helper()
	if err != nil {
		e.t.Fatal(err)
	}
}

func (e *inventoryEnv) itemType(name string) models.ItemType {
	e.t.Helper()
	it := models.ItemType{Name: name, DisplayName: name}
	e.must(e.db.Create(&it).Error)
	return it
}

// カップを作らない種類（グッズ）。種類の名前ではなく makes_cup で見分けるので、名前は others でなくてよい。
func (e *inventoryEnv) goodsType(name string) models.ItemType {
	e.t.Helper()
	no := false
	it := models.ItemType{Name: name, DisplayName: name, MakesCup: &no, NeedsBrew: &no}
	e.must(e.db.Create(&it).Error)
	return it
}

func (e *inventoryEnv) item(name string, typ models.ItemType) models.Item {
	e.t.Helper()
	item := models.Item{Name: name, Abbr: name, ItemTypeID: typ.ID}
	e.must(e.db.Create(&item).Error)
	return item
}

// 在庫対象を作り、1時間前に棚卸しした（実数 1000）ことにする。
func (e *inventoryEnv) resource(name string, kind models.StockResourceKind, usages map[uuid.UUID]float64) models.StockResource {
	e.t.Helper()
	r := models.StockResource{Kind: string(kind), Name: name, Unit: "g", PerServing: 1, NotifyFrom: 0, NotifyStep: 0}
	e.must(e.db.Create(&r).Error)
	for itemID, amount := range usages {
		e.must(e.db.Create(&models.ItemStockUsage{ItemID: itemID, ResourceID: r.ID, Amount: amount}).Error)
	}
	e.must(e.db.Create(&models.StockEvent{ResourceID: r.ID, Kind: string(models.StockEventKindCount), Quantity: 1000, CreatedAt: time.Now().Add(-time.Hour)}).Error)
	return r
}

func (e *inventoryEnv) menu(key string, items ...models.MenuItem) models.Menu {
	e.t.Helper()
	menu := models.Menu{Name: key, Abbr: key, Price: 500, Key: key}
	e.must(e.db.Create(&menu).Error)
	e.setMenuItems(menu, items...)
	return menu
}

// メニューの構成を差し替える（祭の途中でメニューを直す）。
func (e *inventoryEnv) setMenuItems(menu models.Menu, items ...models.MenuItem) {
	e.t.Helper()
	e.must(e.db.Where("menu_id = ?", menu.ID).Delete(&models.MenuItem{}).Error)
	for _, mi := range items {
		mi.MenuID = menu.ID
		e.must(e.db.Create(&mi).Error)
	}
}

// POST /api/orders と同じ手順で注文を作る（カップもその時点の構成で作る）。
func (e *inventoryEnv) order(menus ...models.Menu) uuid.UUID {
	e.t.Helper()
	order := models.Order{ID: uuid.New(), CreatedAt: time.Now(), BillingAmount: 500, Received: 500}
	requests := make([]models.MenuInfoCreate, len(menus))
	for i, menu := range menus {
		requests[i] = models.MenuInfoCreate{MenuId: menu.ID}
	}
	e.must(e.db.Transaction(func(tx *gorm.DB) error {
		lines, cups, err := loadOrderMenus(tx, order.ID, requests, &models.Order{})
		if err != nil {
			return err
		}
		order.OrderMenus, order.OrderCups = lines, cups
		return tx.Create(&order).Error
	}))
	return order.ID
}

// カップを持つ前の注文（明細だけでカップが無い）を作る。
func (e *inventoryEnv) legacyOrder(menus ...models.Menu) uuid.UUID {
	e.t.Helper()
	order := models.Order{ID: uuid.New(), CreatedAt: time.Now(), BillingAmount: 500, Received: 500}
	for _, menu := range menus {
		order.OrderMenus = append(order.OrderMenus, models.OrderMenu{ID: uuid.New(), MenuID: menu.ID, MenuName: menu.Name, UnitPrice: menu.Price})
	}
	e.must(e.db.Create(&order).Error)
	return order.ID
}

type consumptionWant struct {
	consumed float64
	servings int
}

func (e *inventoryEnv) expect(label string, want map[*models.StockResource]consumptionWant) {
	e.t.Helper()
	snapshots, err := e.inv.snapshots(context.Background(), nil)
	e.must(err)
	byID := make(map[uuid.UUID]stockSnapshot, len(snapshots))
	for _, s := range snapshots {
		byID[s.Resource.ID] = s
	}
	for r, w := range want {
		s := byID[r.ID]
		if s.Consumed != w.consumed || s.Servings != w.servings || s.ServingsLastHour != w.servings {
			e.t.Errorf("%s: %s consumed=%v servings=%d last_hour=%d, want consumed=%v servings=%d",
				label, r.Name, s.Consumed, s.Servings, s.ServingsLastHour, w.consumed, w.servings)
		}
	}
}

func (e *inventoryEnv) expectResources(label string, orderID uuid.UUID, want ...models.StockResource) {
	e.t.Helper()
	got := e.inv.ResourceIDsForOrder(orderID)
	wantIDs := make([]uuid.UUID, len(want))
	for i, r := range want {
		wantIDs[i] = r.ID
	}
	less := func(ids []uuid.UUID) func(i, j int) bool {
		return func(i, j int) bool { return ids[i].String() < ids[j].String() }
	}
	sort.Slice(got, less(got))
	sort.Slice(wantIDs, less(wantIDs))
	if len(got) != len(wantIDs) {
		e.t.Fatalf("%s: resources %v, want %v", label, got, wantIDs)
	}
	for i := range got {
		if got[i] != wantIDs[i] {
			e.t.Fatalf("%s: resources %v, want %v", label, got, wantIDs)
		}
	}
}

func TestInventoryCountsOrderCupsNotCurrentMenu(t *testing.T) {
	e := newInventoryEnv(t)
	hot, goodsType := e.itemType("hot"), e.goodsType("物販")
	blendA, blendB := e.item("ブレンドA", hot), e.item("ブレンドB", hot)
	goods := e.item("ドリップバッグ", goodsType)
	beanA := e.resource("豆A", models.StockResourceKindBean, map[uuid.UUID]float64{blendA.ID: 15})
	beanB := e.resource("豆B", models.StockResourceKindBean, map[uuid.UUID]float64{blendB.ID: 12})
	cup := e.resource("カップ", models.StockResourceKindCup, map[uuid.UUID]float64{blendA.ID: 1, blendB.ID: 1})
	bag := e.resource("ドリップバッグ", models.StockResourceKindCup, map[uuid.UUID]float64{goods.ID: 1})

	single := e.menu("single", models.MenuItem{ItemID: blendA.ID, Quantity: 1})
	set := e.menu("set", models.MenuItem{ItemID: blendA.ID, Quantity: 2}, models.MenuItem{ItemID: goods.ID, Quantity: 1})

	// カップは A が3杯。グッズはカップにならないので今の構成から1つ
	first := e.order(single, set)
	before := map[*models.StockResource]consumptionWant{
		&beanA: {45, 3},
		&beanB: {0, 0},
		&cup:   {3, 3},
		&bag:   {1, 1},
	}
	e.expect("メニューを直す前", before)
	e.expectResources("メニューを直す前の注文", first, beanA, cup, bag)

	// 祭の途中で、どちらのメニューも豆を A から B に変える
	e.setMenuItems(single, models.MenuItem{ItemID: blendB.ID, Quantity: 1})
	e.setMenuItems(set, models.MenuItem{ItemID: blendB.ID, Quantity: 2}, models.MenuItem{ItemID: goods.ID, Quantity: 1})

	// 直す前の注文の消費は変わらない（今の構成の B では数えない）
	e.expect("メニューを直した後", before)
	e.expectResources("メニューを直した後の、直す前の注文", first, beanA, cup, bag)

	// 直した後の注文は B で数える
	second := e.order(single)
	e.expect("直した後の注文", map[*models.StockResource]consumptionWant{
		&beanA: {45, 3},
		&beanB: {12, 1},
		&cup:   {4, 4},
		&bag:   {1, 1},
	})
	e.expectResources("直した後の注文", second, beanB, cup)
}

func TestInventoryCountsLegacyOrdersFromMenu(t *testing.T) {
	e := newInventoryEnv(t)
	hot, goodsType := e.itemType("hot"), e.goodsType("物販")
	blendA := e.item("ブレンドA", hot)
	goods := e.item("ドリップバッグ", goodsType)
	beanA := e.resource("豆A", models.StockResourceKindBean, map[uuid.UUID]float64{blendA.ID: 15})
	bag := e.resource("ドリップバッグ", models.StockResourceKindCup, map[uuid.UUID]float64{goods.ID: 1})

	set := e.menu("set", models.MenuItem{ItemID: blendA.ID, Quantity: 2}, models.MenuItem{ItemID: goods.ID, Quantity: 1})
	goodsOnly := e.menu("goods", models.MenuItem{ItemID: goods.ID, Quantity: 3})

	// カップの無い以前の注文は、今のメニューの構成から数える
	legacy := e.legacyOrder(set)
	e.expect("カップの無い注文", map[*models.StockResource]consumptionWant{
		&beanA: {30, 2},
		&bag:   {1, 1},
	})
	e.expectResources("カップの無い注文", legacy, beanA, bag)

	// グッズだけの明細はカップを作らないので、今のメニューの構成から数える
	e.order(goodsOnly)
	e.expect("グッズだけの明細", map[*models.StockResource]consumptionWant{
		&beanA: {30, 2},
		&bag:   {4, 4},
	})
}

func TestInventoryDoesNotCountCupItemTwiceWhenTypeBecomesGoods(t *testing.T) {
	e := newInventoryEnv(t)
	hot, goodsType := e.itemType("hot"), e.goodsType("物販")
	blendA := e.item("ブレンドA", hot)
	beanA := e.resource("豆A", models.StockResourceKindBean, map[uuid.UUID]float64{blendA.ID: 15})
	single := e.menu("single", models.MenuItem{ItemID: blendA.ID, Quantity: 1})

	e.order(single)
	// 注文の後でアイテムの種類をグッズに変えても、カップと構成の両方からは数えない
	e.must(e.db.Model(&blendA).Update("item_type_id", goodsType.ID).Error)
	e.expect("種類をグッズに変えた後", map[*models.StockResource]consumptionWant{
		&beanA: {15, 1},
	})
}
