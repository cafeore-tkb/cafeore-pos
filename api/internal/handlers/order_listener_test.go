package handlers

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/models"
)

// 本物の Postgres が要るので、LISTEN_TEST_DATABASE_URL を渡したときだけ走らせる。
// 中のテーブルは作り直すので、捨ててよい DB を渡すこと。
func openListenTestDB(t *testing.T) (*gorm.DB, string) {
	t.Helper()
	dsn := os.Getenv("LISTEN_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("LISTEN_TEST_DATABASE_URL is not set")
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}),
		&gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	for _, sql := range []string{
		`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
		`DROP TABLE IF EXISTS order_cups, order_menus, comments, orders, menu_items, menus, items, item_types CASCADE`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.AutoMigrate(&models.ItemType{}, &models.Item{}, &models.Menu{}, &models.MenuItem{},
		&models.Order{}, &models.Comment{}, &models.OrderMenu{}, &models.OrderCup{}); err != nil {
		t.Fatal(err)
	}
	trigger, err := os.ReadFile("../../sql/2026-10_orders_notify.sql")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(string(trigger)).Error; err != nil {
		t.Fatal(err)
	}
	return db, dsn
}

func nextBroadcast(t *testing.T, h *Hub) WSMessage {
	t.Helper()
	select {
	case msg := <-h.broadcast:
		return msg
	case <-time.After(5 * time.Second):
		t.Fatal("no broadcast")
		return WSMessage{}
	}
}

func noBroadcast(t *testing.T, h *Hub) {
	t.Helper()
	select {
	case msg := <-h.broadcast:
		t.Fatalf("unexpected broadcast: %s", msg.Type)
	case <-time.After(300 * time.Millisecond):
	}
}

func TestListenOrderChangesPublishesChangedOrder(t *testing.T) {
	db, dsn := openListenTestDB(t)
	hub := NewHub() // Run しないので、配信は hub.broadcast に溜まる
	h := NewOrderHandler(db, hub, nil, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.ListenOrderChanges(ctx, dsn)

	// 待ち受けを始めたら全注文を配り直す
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeOrders {
		t.Fatalf("first broadcast = %s, want orders", msg.Type)
	}

	// API を通さず SQL で書き換えても、変わった注文 1 件が届く。
	// 同じトランザクションで注文・明細・カップを何行書き換えても、届くのは 1 回
	itemType := models.ItemType{Name: "hot", DisplayName: "ホット"}
	item := models.Item{Name: "ブレンド", Abbr: "ブ", ItemType: itemType}
	menu := models.Menu{Name: "ブレンド", Abbr: "ブ", Price: 500, Key: "blend"}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&menu).Error; err != nil {
		t.Fatal(err)
	}
	orderID, lineID := uuid.New(), uuid.New()
	args := map[string]any{"order": orderID, "line": lineID, "menu": menu.ID, "item": item.ID}
	if err := db.Transaction(func(tx *gorm.DB) error {
		for _, sql := range []string{
			`INSERT INTO orders (id, order_id, created_at, billing_amount, received) VALUES (@order, 1, now(), 500, 500)`,
			`INSERT INTO order_menus (id, order_id, menu_id, menu_name, unit_price) VALUES (@line, @order, @menu, 'ブレンド', 500)`,
			`INSERT INTO order_cups (order_id, order_menu_id, item_id, position) VALUES (@order, @line, @item, 0), (@order, @line, @item, 1)`,
		} {
			if err := tx.Exec(sql, args).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	msg := nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeOrder || msg.Order == nil || uuid.UUID(msg.Order.Id) != orderID || len(msg.Order.Cups) != 2 {
		t.Fatalf("broadcast = %+v, want order %s with 2 cups", msg, orderID)
	}
	noBroadcast(t, hub)

	// カップだけの書き換えでも、その注文が届く
	if err := db.Exec(`UPDATE order_cups SET ready_at = now() WHERE order_id = ? AND position = 0`, orderID).Error; err != nil {
		t.Fatal(err)
	}
	msg = nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeOrder || msg.Order.Cups[0].ReadyAt == nil {
		t.Fatalf("broadcast = %+v, want order with first cup ready", msg)
	}

	// 消した注文は削除として届く
	if err := db.Transaction(func(tx *gorm.DB) error {
		for _, sql := range []string{`DELETE FROM order_cups WHERE order_id = ?`, `DELETE FROM order_menus WHERE order_id = ?`, `DELETE FROM orders WHERE id = ?`} {
			if err := tx.Exec(sql, orderID).Error; err != nil {
				return err
			}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	msg = nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeOrderDeleted || msg.OrderID == nil || *msg.OrderID != orderID {
		t.Fatalf("broadcast = %+v, want order_deleted %s", msg, orderID)
	}

	// 注文 ID の載っていない通知（以前の版のトリガー）なら全注文を配り直す
	if err := db.Exec(`SELECT pg_notify('orders_changed', '')`).Error; err != nil {
		t.Fatal(err)
	}
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeOrders {
		t.Fatalf("broadcast = %s, want orders", msg.Type)
	}
}
