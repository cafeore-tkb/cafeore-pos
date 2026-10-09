package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

// 使用量を営業の途中で変えても、変える前の注文は前の使用量で数えることを本物の Postgres で確かめる。
// TEST_DATABASE_URL を渡したときだけ動く。渡した DB の中身には触らず、使い捨ての schema で走らせて終わったら消す。
//
//	TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres go test ./internal/handlers/ -run UsageHistory
func TestInventoryUsageHistoryCountsOrdersWithUsageAtOrderTime(t *testing.T) {
	db := openUsageHistoryTestDB(t)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(db.AutoMigrate(models.All()...))
	inv := NewInventory(db, notify.NewSlack(""), RemindAuth{}, "", nil)
	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.PUT("/usages/:id", NewInventoryHandler(inv).ReplaceItemStockUsages)
	router.GET("/usages", NewInventoryHandler(inv).GetStockUsages)

	itemType := models.ItemType{Name: "hot", DisplayName: "ホット"}
	must(db.Create(&itemType).Error)
	item := models.Item{Name: "ブレンド", Abbr: "ブ", ItemTypeID: itemType.ID}
	must(db.Create(&item).Error)
	bean := models.StockResource{Kind: string(models.StockResourceKindBean), Name: "豆", Unit: "g", PerServing: 15}
	cup := models.StockResource{Kind: string(models.StockResourceKindCup), Name: "カップ", Unit: "個", PerServing: 1}
	must(db.Create(&bean).Error)
	must(db.Create(&cup).Error)
	for _, r := range []models.StockResource{bean, cup} {
		must(db.Create(&models.StockEvent{ResourceID: r.ID, Kind: string(models.StockEventKindCount), Quantity: 1000, CreatedAt: time.Now().Add(-time.Hour)}).Error)
	}
	menu := models.Menu{Name: "ブレンド", Abbr: "ブ", Price: 500, Key: "b"}
	must(db.Create(&menu).Error)
	must(db.Create(&models.MenuItem{MenuID: menu.ID, ItemID: item.ID, Quantity: 1}).Error)

	put := func(beanAmount float64) {
		t.Helper()
		body, _ := json.Marshal([]models.ItemStockUsageRequest{
			{ResourceId: bean.ID, Amount: beanAmount},
			{ResourceId: cup.ID, Amount: 1},
		})
		w := httptest.NewRecorder()
		router.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/usages/"+item.ID.String(), bytes.NewReader(body)))
		if w.Code != http.StatusOK {
			t.Fatalf("PUT usages: %d %s", w.Code, w.Body.String())
		}
	}
	order := func() uuid.UUID {
		t.Helper()
		o := models.Order{CreatedAt: time.Now(), BillingAmount: 500, Received: 500,
			OrderMenus: []models.OrderMenu{{ID: uuid.New(), MenuID: menu.ID, MenuName: menu.Name, UnitPrice: menu.Price}}}
		must(db.Create(&o).Error)
		return o.ID
	}
	expect := func(label string, beanConsumed, cupConsumed float64, servings int) {
		t.Helper()
		snapshots, err := inv.snapshots(context.Background(), nil)
		must(err)
		for _, s := range snapshots {
			want := map[uuid.UUID]float64{bean.ID: beanConsumed, cup.ID: cupConsumed}[s.Resource.ID]
			if s.Consumed != want || s.Servings != servings {
				t.Errorf("%s: %s consumed=%v servings=%d, want consumed=%v servings=%d", label, s.Resource.Name, s.Consumed, s.Servings, want, servings)
			}
		}
	}

	put(15)
	first := order()
	expect("変える前", 15, 1, 1)

	// 営業の途中で豆だけ 20g に変える。カップは変わらないので行もそのまま
	put(20)
	second := order()
	expect("変えた後", 15+20, 2, 2)

	var rows []models.ItemStockUsage
	must(db.Order("valid_from").Find(&rows, "item_id = ?", item.ID).Error)
	if len(rows) != 3 {
		t.Fatalf("rows = %d, want 3（カップ1行・豆の前の行と今の行）: %+v", len(rows), rows)
	}

	// 同じ内容で保存し直しても行は増えない
	put(20)
	var count int64
	must(db.Model(&models.ItemStockUsage{}).Where("item_id = ?", item.ID).Count(&count).Error)
	if count != 3 {
		t.Errorf("同じ内容で保存し直した後の行数 = %d, want 3", count)
	}

	// 一覧は今有効な行だけ
	w := httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/usages", nil))
	var listed []models.StockUsage
	must(json.Unmarshal(w.Body.Bytes(), &listed))
	got := map[uuid.UUID]float64{}
	for _, u := range listed {
		got[uuid.UUID(u.ResourceId)] = u.Amount
	}
	if len(listed) != 2 || got[bean.ID] != 20 || got[cup.ID] != 1 {
		t.Errorf("GET usages = %+v, want 豆 20・カップ 1 の2行", listed)
	}

	// 使用量を外しても、外す前の注文の在庫対象はその注文の時点の使用量で引く
	body, _ := json.Marshal([]models.ItemStockUsageRequest{})
	w = httptest.NewRecorder()
	router.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/usages/"+item.ID.String(), bytes.NewReader(body)))
	if w.Code != http.StatusOK {
		t.Fatalf("PUT usages []: %d %s", w.Code, w.Body.String())
	}
	expect("外した後", 15+20, 2, 2)
	for _, id := range []uuid.UUID{first, second} {
		if got := inv.ResourceIDsForOrder(id); len(got) != 2 {
			t.Errorf("外す前の注文 %s の在庫対象 = %v, want 豆とカップ", id, got)
		}
	}
	if got := inv.ResourceIDsForOrder(order()); len(got) != 0 {
		t.Errorf("外した後の注文の在庫対象 = %v, want なし", got)
	}
}

// テストごとに使い捨ての schema を作って開き、終わったら消す。uuid_generate_v4() は DB の public に入れ、
// search_path を「その schema,public」にして使う。
func openUsageHistoryTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL がないので、DB を使うテストは飛ばす")
	}
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
	if err := admin.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public`).Error; err != nil {
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

	searchPath := schema + ",public"
	if !strings.HasPrefix(dsn, "postgres://") && !strings.HasPrefix(dsn, "postgresql://") {
		return open(dsn + " search_path=" + searchPath)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", searchPath)
	u.RawQuery = q.Encode()
	return open(u.String())
}
