package main

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/testdb"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 本物の Postgres で、起動時のマイグレーションを確かめる。
//
// プレビューは preview ラベルの付いた PR にしか出ないので、ラベルの無い PR は
// main へのデプロイまで AutoMigrate が通るか分からない。ここで先に確かめる。
//
// migrate も findSchemaDrift も本番と同じく public スキーマを前提にしているので、
// handlers の結合テスト（testdb.New）のような schema 分けではなく、テストごとに
// 使い捨ての database（testdb.NewDatabase）を作って流す。渡した DB の中身には触らないので、
// go test ./... で handlers のテストと並行に走っても壊し合わない。

// 空の DB に反映でき、反映したあとの DB がモデルとずれていないこと。
// 2 回目の起動では何も変えないこと（毎回 ALTER が走ると、デプロイのたびにテーブルをロックする）。
func TestMigrateFromEmpty(t *testing.T) {
	rec := &ddlRecorder{}
	db := testdb.NewDatabase(t, rec)

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	rec.ddl = nil
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if ddl := rec.ddl; len(ddl) > 0 {
		t.Errorf("2 回目の migrate がスキーマを変えた（起動のたびに走る）:\n%s", strings.Join(ddl, "\n"))
	}

	drift, err := findSchemaDrift(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(drift) > 0 {
		t.Errorf("migrate したばかりの DB がモデルとずれている:\n%s", strings.Join(drift, "\n"))
	}
}

// Cloud Run が同時に複数のインスタンスを起動しても、全部起動できること。
func TestMigrateConcurrently(t *testing.T) {
	db := testdb.NewDatabase(t, nil)

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	const instances = 3
	errs := make(chan error, instances)
	for range instances {
		go func() { errs <- migrate(db.WithContext(ctx)) }()
	}
	for range instances {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}

	// 1 つずつ走っていれば、全部のテーブルがそろい、ズレも無い
	drift, err := findSchemaDrift(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(drift) > 0 {
		t.Errorf("同時に migrate したあとの DB がモデルとずれている:\n%s", strings.Join(drift, "\n"))
	}
}

var (
	ddlPattern = regexp.MustCompile(`(?i)^\s*(CREATE|ALTER|DROP)\s`)
	// migrate が毎回流す。入っていれば何もしないので数えない
	noopDDLPattern = regexp.MustCompile(`(?i)^\s*CREATE EXTENSION IF NOT EXISTS\s`)
)

// GORM が流した SQL のうち、スキーマを変えるものだけを覚えておく logger。
// 1 つの goroutine の migrate にだけ使う。
type ddlRecorder struct {
	ddl []string
}

func (r *ddlRecorder) LogMode(logger.LogLevel) logger.Interface { return r }
func (r *ddlRecorder) Info(context.Context, string, ...any)     {}
func (r *ddlRecorder) Warn(context.Context, string, ...any)     {}
func (r *ddlRecorder) Error(context.Context, string, ...any)    {}

func (r *ddlRecorder) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	if sql, _ := fc(); ddlPattern.MatchString(sql) && !noopDDLPattern.MatchString(sql) {
		r.ddl = append(r.ddl, sql)
	}
}

func mustExec(t *testing.T, db *gorm.DB, sql string, args ...any) {
	t.Helper()
	if err := db.Exec(sql, args...).Error; err != nil {
		t.Fatal(err)
	}
}

// 種類の項目を足す前の item_types
type itemTypeBeforeFlags struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key"`
	Name        string    `gorm:"not null"`
	DisplayName string    `gorm:"not null"`
	DeletedAt   gorm.DeletedAt
}

func (itemTypeBeforeFlags) TableName() string { return "item_types" }

type itemTypeFlags struct {
	MakesCup, NeedsBrew, SeniorOnly, IcedBrew bool
}

func readItemTypeFlags(t *testing.T, db *gorm.DB) map[string]itemTypeFlags {
	t.Helper()
	var rows []struct {
		Name                                      string
		MakesCup, NeedsBrew, SeniorOnly, IcedBrew bool
	}
	if err := db.Raw("SELECT name, makes_cup, needs_brew, senior_only, iced_brew FROM item_types").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	got := map[string]itemTypeFlags{}
	for _, r := range rows {
		got[r.Name] = itemTypeFlags{r.MakesCup, r.NeedsBrew, r.SeniorOnly, r.IcedBrew}
	}
	return got
}

// 項目の列を足したときだけ、既存の種類に今までの扱いと同じ値を入れる
func TestMigrateBackfillsItemTypeFlags(t *testing.T) {
	db := testdb.NewDatabase(t, nil)
	if err := db.AutoMigrate(&itemTypeBeforeFlags{}); err != nil {
		t.Fatal(err)
	}
	names := []string{"brend", "gourmet", "hot", "ice", "iceOre", "limited", "milk", "others"}
	for _, name := range names {
		if err := db.Create(&itemTypeBeforeFlags{ID: uuid.New(), Name: name, DisplayName: name}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 削除済みの種類も同じに扱う
	deleted := itemTypeBeforeFlags{ID: uuid.New(), Name: "ice", DisplayName: "old ice"}
	if err := db.Create(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&deleted).Error; err != nil {
		t.Fatal(err)
	}

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	coffee := itemTypeFlags{MakesCup: true, NeedsBrew: true}
	iced := itemTypeFlags{MakesCup: true, NeedsBrew: true, IcedBrew: true}
	want := map[string]itemTypeFlags{
		"brend":   coffee,
		"gourmet": coffee,
		"hot":     coffee,
		"ice":     iced,
		"iceOre":  iced,
		"limited": {MakesCup: true, NeedsBrew: true, SeniorOnly: true},
		"milk":    {MakesCup: true},
		"others":  {},
	}
	got := readItemTypeFlags(t, db)
	for name, w := range want {
		if got[name] != w {
			t.Errorf("%s: got %+v, want %+v", name, got[name], w)
		}
	}
	var deletedIced bool
	if err := db.Raw("SELECT iced_brew FROM item_types WHERE id = ?", deleted.ID).Scan(&deletedIced).Error; err != nil {
		t.Fatal(err)
	}
	if !deletedIced {
		t.Error("deleted ice: iced_brew should be backfilled too")
	}

	// 列があれば二度と走らない（画面で変えた値を戻さない）
	mustExec(t, db, "UPDATE item_types SET iced_brew = false WHERE name = 'ice'")
	mustExec(t, db, "UPDATE item_types SET iced_brew = true WHERE name = 'hot'")
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	got = readItemTypeFlags(t, db)
	if got["ice"].IcedBrew || !got["hot"].IcedBrew {
		t.Errorf("backfill ran again: ice %+v, hot %+v", got["ice"], got["hot"])
	}
}

// 表が無い（空の DB）ときは backfill は走らず、列の既定値で作るだけ
func TestMigrateEmptyDatabase(t *testing.T) {
	db := testdb.NewDatabase(t, nil)
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn("item_types", "iced_brew") {
		t.Fatal("item_types.iced_brew was not created")
	}
}

// 在庫をアイテムの在庫とカップに分ける前（main）の stock_resources と item_stock_usages。
type oldStockResource struct {
	ID                 uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	Kind               string    `gorm:"not null;check:kind IN ('cup','bean')"`
	Name               string    `gorm:"not null"`
	Unit               string    `gorm:"not null"`
	PerServing         float64   `gorm:"type:double precision;not null;check:per_serving > 0"`
	NotifyFrom         int       `gorm:"not null"`
	NotifyStep         int       `gorm:"not null"`
	Buffer             int       `gorm:"not null"`
	LastAlertThreshold *int
	DeletedAt          gorm.DeletedAt `gorm:"index"`
}

func (oldStockResource) TableName() string { return "stock_resources" }

type oldItemStockUsage struct {
	ItemID     uuid.UUID `gorm:"type:uuid;primaryKey"`
	ResourceID uuid.UUID `gorm:"type:uuid;primaryKey"`
	Amount     float64   `gorm:"type:double precision;not null;check:amount > 0"`
}

func (oldItemStockUsage) TableName() string { return "item_stock_usages" }

// 前の形の DB（種類の項目も無い）に migrate を流すと、種類の項目の最初の値が入り、アイテムの在庫ができ、
// 前の注文で減った量が埋まり、使用量の表と豆が消える。もう一度流しても何も変わらない。
func TestMigrateSplitsStockIntoItemsAndCups(t *testing.T) {
	db := testdb.NewDatabase(t, nil)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	// 前の形のテーブルの ID の既定値に uuid_generate_v4() が要る
	must(db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error)
	old := []any{&itemTypeBeforeFlags{}, &oldStockResource{}, &oldItemStockUsage{}}
	for _, m := range models.All() {
		switch m.(type) {
		case *models.ItemType, *models.StockResource, *models.StockResourceItemType, *models.OrderStockUsage:
		default:
			old = append(old, m)
		}
	}
	must(db.AutoMigrate(old...))

	hot := itemTypeBeforeFlags{ID: uuid.New(), Name: "hot", DisplayName: "ホット"}
	must(db.Create(&hot).Error)
	must(db.Create(&itemTypeBeforeFlags{ID: uuid.New(), Name: "others", DisplayName: "グッズ"}).Error)
	blend := models.Item{Name: "ブレンド", Abbr: "ブ", ItemTypeID: hot.ID}
	gone := models.Item{Name: "販売終了", Abbr: "終", ItemTypeID: hot.ID}
	must(db.Create(&blend).Error)
	must(db.Create(&gone).Error)
	must(db.Delete(&gone).Error)
	cup := oldStockResource{Kind: "cup", Name: "ホットカップ", Unit: "個", PerServing: 1}
	bean := oldStockResource{Kind: "bean", Name: "豆", Unit: "g", PerServing: 15}
	must(db.Create(&cup).Error)
	must(db.Create(&bean).Error)
	must(db.Create(&models.StockEvent{ResourceID: bean.ID, Kind: "count", Quantity: 1000, CreatedAt: time.Now()}).Error)
	must(db.Create(&models.StockEvent{ResourceID: cup.ID, Kind: "count", Quantity: 500, CreatedAt: time.Now()}).Error)
	must(db.Create(&[]oldItemStockUsage{{ItemID: blend.ID, ResourceID: cup.ID, Amount: 1}, {ItemID: blend.ID, ResourceID: bean.ID, Amount: 15}}).Error)
	menu := models.Menu{Name: "ブレンド2杯", Abbr: "ブ2", Price: 1000, Key: "b2", MenuItems: []models.MenuItem{{ItemID: blend.ID, Quantity: 2}}}
	must(db.Create(&menu).Error)
	line := models.OrderMenu{ID: uuid.New(), MenuID: menu.ID, MenuName: menu.Name, UnitPrice: menu.Price}
	order := models.Order{CreatedAt: time.Now(), BillingAmount: 1000, Received: 1000, OrderMenus: []models.OrderMenu{line}}
	must(db.Create(&order).Error)

	for range 2 {
		must(migrate(db))

		var resources []models.StockResource
		must(db.Order("kind").Find(&resources).Error)
		if len(resources) != 2 || resources[0].ID != cup.ID || resources[0].Kind != "cup" ||
			resources[1].Kind != "item" || *resources[1].ItemID != blend.ID {
			t.Fatalf("在庫対象 = %+v, want カップと、消していないアイテムの在庫だけ", resources)
		}
		var usages []models.OrderStockUsage
		must(db.Find(&usages).Error)
		if len(usages) != 1 || usages[0].OrderMenuID != line.ID || usages[0].OrderID != order.ID ||
			usages[0].ResourceID != cup.ID || usages[0].Servings != 2 || usages[0].Amount != 2 {
			t.Errorf("前の注文で減った量 = %+v, want カップ 2", usages)
		}
		if flags := readItemTypeFlags(t, db); flags["hot"] != (itemTypeFlags{MakesCup: true, NeedsBrew: true}) || flags["others"] != (itemTypeFlags{}) {
			t.Errorf("種類の項目 = %+v", flags)
		}
		var beanEvents int64
		must(db.Model(&models.StockEvent{}).Where("resource_id = ?", bean.ID).Count(&beanEvents).Error)
		if beanEvents != 0 || db.Migrator().HasTable("item_stock_usages") {
			t.Errorf("豆の記録 %d 件・使用量の表 %v が残っている", beanEvents, db.Migrator().HasTable("item_stock_usages"))
		}
	}
	// kind の check は新しい形に付け替わっている
	if err := db.Create(&models.StockResource{Kind: "bean", Name: "豆", Unit: "g", PerServing: 15}).Error; err == nil {
		t.Error("kind bean を作れてしまう")
	}
}

// 名前を変える前のドリッパーの担当者と交代の記録（#833 で入れた形）
type caosLaneBeforeRename struct {
	Day       string    `gorm:"type:date;primaryKey;autoIncrement:false"`
	Dripper   int       `gorm:"type:smallint;primaryKey;autoIncrement:false;check:caos_lanes_dripper_check,dripper BETWEEN 1 AND 6"`
	Name      string    `gorm:"not null"`
	Senior    bool      `gorm:"not null;default:false"`
	UpdatedAt time.Time `gorm:"not null"`
}

func (caosLaneBeforeRename) TableName() string { return "caos_lanes" }

type caosLaneChangeBeforeRename struct {
	ID        int64     `gorm:"primaryKey"`
	ChangedAt time.Time `gorm:"not null"`
	Day       string    `gorm:"type:date;not null;index"`
	Dripper   int       `gorm:"type:smallint;not null;check:caos_lane_changes_dripper_check,dripper BETWEEN 1 AND 6"`
	PrevName  string    `gorm:"not null"`
	Name      string    `gorm:"not null"`
	Senior    bool      `gorm:"not null;default:false"`
}

func (caosLaneChangeBeforeRename) TableName() string { return "caos_lane_changes" }

// 前の名前の表は、行を残したまま今の名前に変わる。2 回目は何もせず、モデルともずれない
func TestMigrateRenamesTables(t *testing.T) {
	rec := &ddlRecorder{}
	db := testdb.NewDatabase(t, rec)
	if err := db.AutoMigrate(&caosLaneBeforeRename{}, &caosLaneChangeBeforeRename{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	if err := db.Create(&caosLaneBeforeRename{Day: "2026-10-11", Dripper: 1, Name: "山田", Senior: true, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&caosLaneChangeBeforeRename{ChangedAt: now, Day: "2026-10-11", Dripper: 1, Name: "山田", Senior: true}).Error; err != nil {
		t.Fatal(err)
	}

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	var lanes, changes []string
	if err := db.Raw("SELECT day::text || ' ' || dripper || ' ' || name || ' ' || senior FROM dripper_assignees").Scan(&lanes).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Raw("SELECT id || ' ' || dripper || ' ' || prev_name || '>' || name FROM dripper_assignee_changes").Scan(&changes).Error; err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(lanes, ",") + " / " + strings.Join(changes, ","); got != "2026-10-11 1 山田 true / 1 1 >山田" {
		t.Errorf("rows after rename = %s", got)
	}
	// 連番は前の表の続きから
	mustExec(t, db, "INSERT INTO dripper_assignee_changes (changed_at, day, dripper, prev_name, name) VALUES (now(), '2026-10-11', 1, '山田', '佐藤')")
	var maxID int64
	if err := db.Raw("SELECT max(id) FROM dripper_assignee_changes").Scan(&maxID).Error; err != nil {
		t.Fatal(err)
	}
	if maxID != 2 {
		t.Errorf("next id = %d, want 2", maxID)
	}

	// 表・索引・制約・連番に前の名前が残らない
	var left []string
	if err := db.Raw(`
		SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
		WHERE n.nspname = 'public' AND c.relname LIKE '%caos%'
		UNION ALL
		SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace
		WHERE n.nspname = 'public' AND conname LIKE '%caos%'`).Scan(&left).Error; err != nil {
		t.Fatal(err)
	}
	if len(left) > 0 {
		t.Errorf("前の名前が残っている: %v", left)
	}

	rec.ddl = nil
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if ddl := rec.ddl; len(ddl) > 0 {
		t.Errorf("2 回目の migrate がスキーマを変えた:\n%s", strings.Join(ddl, "\n"))
	}
	drift, err := findSchemaDrift(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(drift) > 0 {
		t.Errorf("名前を変えたあとの DB がモデルとずれている:\n%s", strings.Join(drift, "\n"))
	}
}

func readColorSettings(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var rows []string
	if err := db.Raw("SELECT target_type || ' ' || screen || ' ' || color FROM color_settings ORDER BY 1").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	return strings.Join(rows, ",")
}

// 色の設定の画面の前の名前（caos_nominated）は今の名前（nominated）に変わる。同じ対象に今の名前の行があれば、前の名前の行は消える。
// 2 回目は何も変えず、スキーマも変えない
func TestMigrateRenamesColorScreen(t *testing.T) {
	rec := &ddlRecorder{}
	db := testdb.NewDatabase(t, rec)
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	item, itemType := uuid.New(), uuid.New()
	mustExec(t, db, `INSERT INTO color_settings (id, target_type, target_id, screen, color, created_at, updated_at) VALUES
		(?, 'Item', ?, 'caos_nominated', '#111111', now(), now()),
		(?, 'Item', ?, 'master', '#222222', now(), now()),
		(?, 'ItemType', ?, 'caos_nominated', '#333333', now(), now()),
		(?, 'ItemType', ?, 'nominated', '#444444', now(), now())`,
		uuid.New(), item, uuid.New(), item, uuid.New(), itemType, uuid.New(), itemType)

	const want = "Item master #222222,Item nominated #111111,ItemType nominated #444444"
	rec.ddl = nil
	for range 2 {
		if err := migrate(db); err != nil {
			t.Fatal(err)
		}
		if got := readColorSettings(t, db); got != want {
			t.Errorf("color_settings = %s, want %s", got, want)
		}
	}
	if ddl := rec.ddl; len(ddl) > 0 {
		t.Errorf("migrate がスキーマを変えた:\n%s", strings.Join(ddl, "\n"))
	}
	drift, err := findSchemaDrift(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(drift) > 0 {
		t.Errorf("値を変えたあとの DB がモデルとずれている:\n%s", strings.Join(drift, "\n"))
	}
}

func menuKeyIndexDef(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var def string
	if err := db.Raw("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_menus_key'").Scan(&def).Error; err != nil {
		t.Fatal(err)
	}
	return def
}

func squareCheckoutOrderIndexDef(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var def string
	if err := db.Raw("SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_square_checkouts_order_id'").Scan(&def).Error; err != nil {
		t.Fatal(err)
	}
	return def
}

// 前の形（一意）の square_checkouts.order_id の索引は一意でない索引に変わり、1 つの注文に決済を
// 2 つ結び付けられる（個別会計）。2 回目は何もせず、モデルともずれない
func TestMigrateSquareCheckoutOrderIndexAllowsSplitPayments(t *testing.T) {
	rec := &ddlRecorder{}
	db := testdb.NewDatabase(t, rec)
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	const plain = "CREATE INDEX idx_square_checkouts_order_id ON public.square_checkouts USING btree (order_id)"
	if def := squareCheckoutOrderIndexDef(t, db); def != plain {
		t.Fatalf("空の DB に作った索引 = %s", def)
	}
	mustExec(t, db, "DROP INDEX idx_square_checkouts_order_id")
	mustExec(t, db, `CREATE UNIQUE INDEX "idx_square_checkouts_order_id" ON "square_checkouts" ("order_id")`)

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if def := squareCheckoutOrderIndexDef(t, db); def != plain {
		t.Fatalf("索引 = %s, want %s", def, plain)
	}
	orderID := uuid.New()
	for i := range 2 {
		checkout := models.SquareCheckout{
			IdempotencyKey: uuid.NewString(), DeviceID: "device-1", Amount: 600, PaymentType: "CARD_PRESENT",
			Status: "COMPLETED", OrderID: &orderID, OrderNumber: &i,
		}
		if err := db.Create(&checkout).Error; err != nil {
			t.Fatalf("同じ注文に 2 つ目の決済を結び付けられない: %v", err)
		}
	}

	rec.ddl = nil
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if ddl := rec.ddl; len(ddl) > 0 {
		t.Errorf("2 回目の migrate がスキーマを変えた:\n%s", strings.Join(ddl, "\n"))
	}
	drift, err := findSchemaDrift(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(drift) > 0 {
		t.Errorf("索引を作り直したあとの DB がモデルとずれている:\n%s", strings.Join(drift, "\n"))
	}
}

// 前の形（消したメニューも数える）のメニューのキーの索引は、消していないメニューだけの部分索引に変わり、
// 消したメニューのキーを使える。2 回目は何もせず、モデルともずれない
func TestMigrateMenuKeyIndexIgnoresDeletedMenus(t *testing.T) {
	rec := &ddlRecorder{}
	db := testdb.NewDatabase(t, rec)
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	const partial = "CREATE UNIQUE INDEX idx_menus_key ON public.menus USING btree (key) WHERE (deleted_at IS NULL)"
	if def := menuKeyIndexDef(t, db); def != partial {
		t.Fatalf("空の DB に作った索引 = %s", def)
	}
	mustExec(t, db, "DROP INDEX idx_menus_key")
	mustExec(t, db, `CREATE UNIQUE INDEX "idx_menus_key" ON "menus" ("key")`)
	old := models.Menu{Name: "トートバッグ", Abbr: "ト", Price: 1500, Key: "*"}
	if err := db.Create(&old).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&old).Error; err != nil {
		t.Fatal(err)
	}

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if def := menuKeyIndexDef(t, db); def != partial {
		t.Fatalf("索引 = %s, want %s", def, partial)
	}
	if err := db.Create(&models.Menu{Name: "缶バッジ", Abbr: "缶", Price: 300, Key: "*"}).Error; err != nil {
		t.Fatalf("消したメニューのキーを使えない: %v", err)
	}

	rec.ddl = nil
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if ddl := rec.ddl; len(ddl) > 0 {
		t.Errorf("2 回目の migrate がスキーマを変えた:\n%s", strings.Join(ddl, "\n"))
	}
	drift, err := findSchemaDrift(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(drift) > 0 {
		t.Errorf("索引を作り直したあとの DB がモデルとずれている:\n%s", strings.Join(drift, "\n"))
	}
}
