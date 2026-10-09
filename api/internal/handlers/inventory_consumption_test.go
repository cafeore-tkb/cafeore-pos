package handlers

import (
	"bytes"
	"context"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

// 在庫の消費を本物の Postgres で数える（inventory.go の orderItemsSQL）。TEST_DATABASE_URL を渡したときだけ動く。
// 渡した DB の中身には触らず、テストごとに使い捨ての schema を作って終わったら消すので、
// ほかの DB のテストと同じ DB を指しても壊し合わない。
//
//	TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres go test ./internal/handlers/ -run Inventory
//
// TODO: #790 がマージされたら、この準備は #790 の api/internal/testdb（testdb.New）に寄せる
// （TEST_DATABASE_URL を読む・無ければスキップ・CI では落とす、の決まりも testdb にまとまっている）。
// 今はまだ testdb が無いので、ここで同じ形の準備をしている。CI に Postgres が無いうちは落とさずスキップする。

type inventoryEnv struct {
	t   *testing.T
	db  *gorm.DB
	inv *Inventory
}

func newInventoryEnv(t *testing.T) *inventoryEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL がないので、DB を使うテストは飛ばす")
	}
	db := openInventoryTestSchema(t, dsn)
	e := &inventoryEnv{t: t, db: db, inv: NewInventory(db, notify.NewSlack(""), RemindAuth{}, "")}
	e.must(db.AutoMigrate(models.All()...))
	return e
}

// テストごとに使い捨ての schema を作って開き、終わったら消す。uuid_generate_v4() は DB の public に入れ、
// search_path を「その schema,public」にして使う（#790 の testdb.New と同じ形）。
func openInventoryTestSchema(t *testing.T, dsn string) *gorm.DB {
	t.Helper()
	open := func(dsn string) *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}),
			&gorm.Config{Logger: logger.Discard, DisableForeignKeyConstraintWhenMigrating: true})
		if err != nil {
			t.Fatal(err)
		}
		sqlDB, err := db.DB()
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() { _ = sqlDB.Close() })
		return db
	}

	admin := open(dsn)
	// ほかのテスト（別のパッケージのテストのプロセスを含む）と同時に入れてもぶつからないよう、advisory lock で 1 つずつにする
	if err := admin.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", int64(0x7465737464627831)).Error; err != nil {
			return err
		}
		return tx.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public`).Error
	}); err != nil {
		t.Fatal(err)
	}
	schema := "test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	// t.Cleanup は後に登録したものから走るので、下で開く接続を閉じてから消す
	t.Cleanup(func() {
		if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Errorf("failed to drop schema %s: %v", schema, err)
		}
	})
	return open(withSearchPath(t, dsn, schema+",public"))
}

// 接続文字列に search_path を足す（どの接続もその schema を見るように）。URL でも key=value でもよい。
func withSearchPath(t *testing.T, dsn, searchPath string) string {
	t.Helper()
	if !strings.HasPrefix(dsn, "postgres://") && !strings.HasPrefix(dsn, "postgresql://") {
		return dsn + " search_path=" + searchPath
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", searchPath)
	u.RawQuery = q.Encode()
	return u.String()
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
	it := models.ItemType{Name: name, DisplayName: name, MakesCup: boolPtr(false), NeedsBrew: boolPtr(false)}
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

// POST /api/orders と同じ手順で注文を作る（明細の構成とカップをその時点の構成で作る）。
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

// 構成もカップも持たない明細の注文（構成を残す前の版の API が作ったもの）を作る。
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
	byBytes := func(a, b uuid.UUID) int { return bytes.Compare(a[:], b[:]) }
	slices.SortFunc(got, byBytes)
	slices.SortFunc(wantIDs, byBytes)
	if !slices.Equal(got, wantIDs) {
		e.t.Fatalf("%s: resources %v, want %v", label, got, wantIDs)
	}
}

func TestInventoryCountsOrderTimeMenuNotCurrentMenu(t *testing.T) {
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

	// 注文した時点の構成で、A が3杯とグッズが1つ
	first := e.order(single, set)
	before := map[*models.StockResource]consumptionWant{
		&beanA: {45, 3},
		&beanB: {0, 0},
		&cup:   {3, 3},
		&bag:   {1, 1},
	}
	e.expect("メニューを直す前", before)
	e.expectResources("メニューを直す前の注文", first, beanA, cup, bag)

	// 祭の途中で、どちらのメニューも豆を A から B に変え、セットのグッズを2つにする
	e.setMenuItems(single, models.MenuItem{ItemID: blendB.ID, Quantity: 1})
	e.setMenuItems(set, models.MenuItem{ItemID: blendB.ID, Quantity: 2}, models.MenuItem{ItemID: goods.ID, Quantity: 2})

	// 直す前の注文の消費は変わらない（今の構成の B やグッズ2つでは数えない）
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

	// 構成を持たない明細は、今のメニューの構成から数える
	legacy := e.legacyOrder(set)
	e.expect("カップの無い注文", map[*models.StockResource]consumptionWant{
		&beanA: {30, 2},
		&bag:   {1, 1},
	})
	e.expectResources("カップの無い注文", legacy, beanA, bag)

	// グッズだけの明細（カップを作らない）も、注文した時点の構成で数える
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

func TestInventoryCountsGoodsWhenTypeStartsMakingCups(t *testing.T) {
	e := newInventoryEnv(t)
	hot, goodsType := e.itemType("hot"), e.goodsType("物販")
	blendA := e.item("ブレンドA", hot)
	goods := e.item("ドリップバッグ", goodsType)
	beanA := e.resource("豆A", models.StockResourceKindBean, map[uuid.UUID]float64{blendA.ID: 15})
	bag := e.resource("ドリップバッグ", models.StockResourceKindCup, map[uuid.UUID]float64{goods.ID: 1})
	set := e.menu("set", models.MenuItem{ItemID: blendA.ID, Quantity: 1}, models.MenuItem{ItemID: goods.ID, Quantity: 1})

	order := e.order(set)
	// 注文の後で種類を「カップを作る」に変えても、注文のときカップにならなかった品物は漏れない
	e.must(e.db.Model(&goodsType).Update("makes_cup", true).Error)
	e.expect("種類をカップを作るに変えた後", map[*models.StockResource]consumptionWant{
		&beanA: {15, 1},
		&bag:   {1, 1},
	})
	e.expectResources("種類をカップを作るに変えた後", order, beanA, bag)
}
