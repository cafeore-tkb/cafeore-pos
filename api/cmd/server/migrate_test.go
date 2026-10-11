package main

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"

	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/testdb"
)

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

// 前の形の DB に migrate を流すと、アイテムの在庫ができ、前の注文で減った量が埋まり、使用量の表と豆が消える。
// もう一度流しても何も変わらない。TEST_DATABASE_URL を渡したときだけ動く（internal/testdb）。
func TestMigrateSplitsStockIntoItemsAndCups(t *testing.T) {
	db := testdb.Open(t)
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	old := []any{&oldStockResource{}, &oldItemStockUsage{}}
	for _, m := range models.All() {
		switch m.(type) {
		case *models.StockResource, *models.StockResourceItemType, *models.OrderStockUsage:
		default:
			old = append(old, m)
		}
	}
	must(db.AutoMigrate(old...))

	hot := models.ItemType{Name: "hot", DisplayName: "ホット"}
	must(db.Create(&hot).Error)
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
