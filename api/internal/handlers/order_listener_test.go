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

func TestListenOrderChangesPublishesOtherInstancesOrders(t *testing.T) {
	db, dsn := openListenTestDB(t)
	hub := NewHub() // Run しないので、配信は hub.broadcast に溜まる
	h := NewOrderHandler(db, hub, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.ListenOrderChanges(ctx, dsn)

	// 待ち受けを始めたら全注文を配り直す
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeOrders {
		t.Fatalf("first broadcast = %s, want orders", msg.Type)
	}

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
	order := models.Order{
		ID: orderID, OrderId: 1, CreatedAt: time.Now(), BillingAmount: 500, Received: 500,
		OrderMenus: []models.OrderMenu{{ID: lineID, MenuID: menu.ID, MenuName: "ブレンド", UnitPrice: 500}},
		OrderCups: []models.OrderCup{
			{OrderMenuID: lineID, ItemID: item.ID, Position: 0},
			{OrderMenuID: lineID, ItemID: item.ID, Position: 1},
		},
	}
	if err := db.Create(&order).Error; err != nil {
		t.Fatal(err)
	}

	// このインスタンスで書き換えたときは、その場で 1 回だけ配る（自分の通知では配り直さない）
	if _, err := publishOrder(db, hub, orderID); err != nil {
		t.Fatal(err)
	}
	msg := nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeOrder || uuid.UUID(msg.Order.Id) != orderID || len(msg.Order.Cups) != 2 {
		t.Fatalf("broadcast = %+v, want order %s with 2 cups", msg, orderID)
	}
	noBroadcast(t, hub)

	// ほかのインスタンスで書き換わったら、通知を受けてその注文を読み直して配る
	if err := db.Exec(`UPDATE order_cups SET ready_at = now() WHERE order_id = ? AND position = 0`, orderID).Error; err != nil {
		t.Fatal(err)
	}
	notifyFromOtherInstance(t, db, orderID.String())
	msg = nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeOrder || msg.Order.Cups[0].ReadyAt == nil {
		t.Fatalf("broadcast = %+v, want order with first cup ready", msg)
	}
	noBroadcast(t, hub)

	// ほかのインスタンスで消えた注文は削除として届く
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
	notifyFromOtherInstance(t, db, orderID.String())
	msg = nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeOrderDeleted || msg.OrderID == nil || *msg.OrderID != orderID {
		t.Fatalf("broadcast = %+v, want order_deleted %s", msg, orderID)
	}

	// ほかのインスタンスの確認の通知では何も配らない
	if err := db.Exec("SELECT pg_notify(?, ?)", ordersChangedChannel, listenProbePrefix+uuid.NewString()+" x").Error; err != nil {
		t.Fatal(err)
	}
	noBroadcast(t, hub)

	// 形の分からない通知なら全注文を配り直す
	if err := db.Exec(`SELECT pg_notify('orders_changed', '')`).Error; err != nil {
		t.Fatal(err)
	}
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeOrders {
		t.Fatalf("broadcast = %s, want orders", msg.Type)
	}
}

func notifyFromOtherInstance(t *testing.T, db *gorm.DB, orderID string) {
	t.Helper()
	if err := db.Exec("SELECT pg_notify(?, ?)", ordersChangedChannel, uuid.NewString()+" "+orderID).Error; err != nil {
		t.Fatal(err)
	}
}

func TestOrderChangesCoalesces(t *testing.T) {
	q := newOrderChanges()
	a, b := uuid.New(), uuid.New()
	other := uuid.NewString()

	// 同じ注文の通知が重なったら 1 つにまとめ、自分が送ったものは積まない
	q.addPayload(other + " " + a.String())
	q.addPayload(other + " " + a.String())
	q.addPayload(other + " " + b.String())
	q.addPayload(instanceID + " " + uuid.NewString())
	select {
	case <-q.wake:
	default:
		t.Fatal("not woken")
	}
	ids, all := q.take()
	if all || len(ids) != 2 {
		t.Fatalf("take() = %v, %v; want 2 ids", ids, all)
	}
	if got := map[uuid.UUID]bool{ids[0]: true, ids[1]: true}; !got[a] || !got[b] {
		t.Fatalf("take() = %v, want %s and %s", ids, a, b)
	}

	// 取り出したら空になる
	if ids, all := q.take(); all || len(ids) != 0 {
		t.Fatalf("take() after take = %v, %v; want empty", ids, all)
	}

	// 形の分からない通知が混ざれば全注文の配り直しだけにする
	q.addPayload(other + " " + a.String())
	q.addPayload("")
	q.addPayload(other + " not-a-uuid")
	if ids, all := q.take(); !all || len(ids) != 0 {
		t.Fatalf("take() = %v, %v; want all", ids, all)
	}
}
