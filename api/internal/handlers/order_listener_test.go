package handlers

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
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
		`DROP TABLE IF EXISTS order_cups, order_menus, comments, orders, menu_items, menus, items, item_types, master_states, cashier_states CASCADE`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.AutoMigrate(&models.ItemType{}, &models.Item{}, &models.Menu{}, &models.MenuItem{},
		&models.Order{}, &models.Comment{}, &models.OrderMenu{}, &models.OrderCup{},
		&models.MasterState{}, &models.CashierState{}); err != nil {
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

func TestListenChangesPublishesOtherInstancesOrders(t *testing.T) {
	db, dsn := openListenTestDB(t)
	hub := NewHub() // Run しないので、配信は hub.broadcast に溜まる
	h := NewOrderHandler(db, hub, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.ListenChanges(ctx, dsn)

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

// ハンドラを1回呼ぶ。body は JSON
func callHandler(t *testing.T, handler gin.HandlerFunc, method, body string) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	handler(c)
	return w
}

// ほかのインスタンスが送ったように、別のインスタンス ID で状態の変更を通知する
func notifyStateFromOtherInstance(t *testing.T, db *gorm.DB, channel string) {
	t.Helper()
	if err := db.Exec("SELECT pg_notify(?, ?)", channel, uuid.NewString()).Error; err != nil {
		t.Fatal(err)
	}
}

// ほかのインスタンスの代わりに channels を待ち受ける接続
func listenAsOtherInstance(t *testing.T, dsn string, channels ...string) *pgx.Conn {
	t.Helper()
	conn, err := pgx.Connect(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = conn.Close(context.Background()) })
	for _, channel := range channels {
		if _, err := conn.Exec(context.Background(), "LISTEN "+channel); err != nil {
			t.Fatal(err)
		}
	}
	return conn
}

// このインスタンスから channel に通知が届くことを確かめる。
// テストがほかのインスタンスのふりをして送った通知は読み飛ばす。
func expectNotification(t *testing.T, conn *pgx.Conn, channel string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	for {
		n, err := conn.WaitForNotification(ctx)
		if err != nil {
			t.Fatalf("no notification on %s from this instance: %v", channel, err)
		}
		if n.Payload != instanceID {
			continue
		}
		if n.Channel != channel {
			t.Fatalf("notification on %s, want %s", n.Channel, channel)
		}
		return
	}
}

func TestListenChangesPublishesOtherInstancesStates(t *testing.T) {
	db, dsn := openListenTestDB(t)
	other := listenAsOtherInstance(t, dsn, masterStateChangedChannel, cashierStateChangedChannel)
	hub := NewHub() // Run しないので、配信は hub.broadcast に溜まる
	h := NewOrderHandler(db, hub, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.ListenChanges(ctx, dsn)

	// まだオーダーストップもレジの状態も無いので、待ち受けを始めたときは全注文だけを配る
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeOrders {
		t.Fatalf("first broadcast = %s, want orders", msg.Type)
	}
	noBroadcast(t, hub)

	// このインスタンスでオーダーストップしたときは、その場で 1 回だけ配り（自分の通知では配り直さない）、
	// ほかのインスタンスへ通知する
	if w := callHandler(t, NewMasterStateHandler(db, hub).UpdateMasterStatus, http.MethodPost, `{"type":"stop"}`); w.Code != http.StatusCreated {
		t.Fatalf("POST master-status = %d: %s", w.Code, w.Body)
	}
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeMasterState || msg.MasterState.Type != "stop" {
		t.Fatalf("broadcast = %+v, want master_state stop", msg)
	}
	expectNotification(t, other, masterStateChangedChannel)
	noBroadcast(t, hub)

	// ほかのインスタンスでオーダーストップを解除したら、通知を受けて読み直して配る
	if err := db.Create(&models.MasterState{Type: "operational", CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	notifyStateFromOtherInstance(t, db, masterStateChangedChannel)
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeMasterState || msg.MasterState.Type != "operational" {
		t.Fatalf("broadcast = %+v, want master_state operational", msg)
	}
	noBroadcast(t, hub)

	// このインスタンスでレジの状態を変えたときも、その場で 1 回だけ配り、ほかのインスタンスへ通知する
	body := `{"editting_order":` + validEdittingOrder + `,"submitted_order_id":null}`
	if w := callHandler(t, NewCashierStateHandler(db, hub).UpdateCashierState, http.MethodPut, body); w.Code != http.StatusOK {
		t.Fatalf("PUT cashier-state = %d: %s", w.Code, w.Body)
	}
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeCashierState || msg.CashierState.SubmittedOrderId != nil {
		t.Fatalf("broadcast = %+v, want cashier_state without submitted order", msg)
	}
	expectNotification(t, other, cashierStateChangedChannel)
	noBroadcast(t, hub)

	// ほかのインスタンスでレジの状態が変わったら、通知を受けて読み直して配る
	submitted := uuid.New()
	if err := db.Model(&models.CashierState{}).Where("id = ?", models.CashierStateID).
		Update("submitted_order_id", submitted).Error; err != nil {
		t.Fatal(err)
	}
	notifyStateFromOtherInstance(t, db, cashierStateChangedChannel)
	msg := nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeCashierState || msg.CashierState.SubmittedOrderId == nil ||
		uuid.UUID(*msg.CashierState.SubmittedOrderId) != submitted {
		t.Fatalf("broadcast = %+v, want cashier_state with submitted order %s", msg, submitted)
	}
	noBroadcast(t, hub)

	// 自分が送った通知では配り直さない
	notifyMasterStateChanged(db)
	notifyCashierStateChanged(db)
	noBroadcast(t, hub)
}

func TestListenChangesRepublishesStatesWhenListening(t *testing.T) {
	db, dsn := openListenTestDB(t)
	if err := db.Create(&models.MasterState{Type: "stop", CreatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	state := models.CashierState{ID: models.CashierStateID, EdittingOrder: models.JSONB(validEdittingOrder), UpdatedAt: time.Now()}
	if err := db.Create(&state).Error; err != nil {
		t.Fatal(err)
	}

	hub := NewHub()
	h := NewOrderHandler(db, hub, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.ListenChanges(ctx, dsn)

	// 待ち受けを始めたら、取りこぼしに備えて全注文・オーダーストップ・レジの状態を配り直す
	got := map[WSMessageType]WSMessage{}
	for range 3 {
		msg := nextBroadcast(t, hub)
		got[msg.Type] = msg
	}
	if _, ok := got[WSMessageTypeOrders]; !ok {
		t.Fatalf("broadcasts = %+v, want orders", got)
	}
	if msg, ok := got[WSMessageTypeMasterState]; !ok || msg.MasterState.Type != "stop" {
		t.Fatalf("broadcasts = %+v, want master_state stop", got)
	}
	if _, ok := got[WSMessageTypeCashierState]; !ok {
		t.Fatalf("broadcasts = %+v, want cashier_state", got)
	}
	noBroadcast(t, hub)
}

func TestPendingChangesCoalesces(t *testing.T) {
	q := newPendingChanges()
	a, b := uuid.New(), uuid.New()
	other := uuid.NewString()

	// 同じ注文の通知が重なったら 1 つにまとめ、自分が送ったものは積まない
	q.add(ordersChangedChannel, other+" "+a.String())
	q.add(ordersChangedChannel, other+" "+a.String())
	q.add(ordersChangedChannel, other+" "+b.String())
	q.add(ordersChangedChannel, instanceID+" "+uuid.NewString())
	q.add(masterStateChangedChannel, instanceID)
	q.add(cashierStateChangedChannel, instanceID)
	select {
	case <-q.wake:
	default:
		t.Fatal("not woken")
	}
	s := q.take()
	if s.allOrders || s.masterState || s.cashierState || len(s.orderIDs) != 2 {
		t.Fatalf("take() = %+v; want 2 order ids only", s)
	}
	for _, id := range []uuid.UUID{a, b} {
		if _, ok := s.orderIDs[id]; !ok {
			t.Fatalf("take() = %+v, want %s", s, id)
		}
	}

	// 取り出したら空になる
	if s := q.take(); s.allOrders || s.masterState || s.cashierState || len(s.orderIDs) != 0 {
		t.Fatalf("take() after take = %+v; want empty", s)
	}

	// 形の分からない注文の通知が混ざれば全注文の配り直しだけにする
	q.add(ordersChangedChannel, other+" "+a.String())
	q.add(ordersChangedChannel, "")
	q.add(ordersChangedChannel, other+" not-a-uuid")
	if s := q.take(); !s.allOrders || s.masterState || s.cashierState || len(s.orderIDs) != 0 {
		t.Fatalf("take() = %+v; want all orders", s)
	}

	// オーダーストップとレジの状態は、ほかのインスタンスからの通知が何度来ても 1 回にまとめる
	q.add(masterStateChangedChannel, other)
	q.add(masterStateChangedChannel, uuid.NewString())
	q.add(cashierStateChangedChannel, other)
	q.add(cashierStateChangedChannel, "")
	if s := q.take(); s.allOrders || !s.masterState || !s.cashierState || len(s.orderIDs) != 0 {
		t.Fatalf("take() = %+v; want master and cashier states", s)
	}

	// 待ち受けを始めたときは全部を配り直す
	q.add(ordersChangedChannel, other+" "+a.String())
	q.addAll()
	if s := q.take(); !s.allOrders || !s.masterState || !s.cashierState || len(s.orderIDs) != 0 {
		t.Fatalf("take() = %+v; want everything", s)
	}
}

func TestPendingChangesRequeue(t *testing.T) {
	q := newPendingChanges()
	a, b := uuid.New(), uuid.New()
	other := uuid.NewString()

	// 失敗した注文を積み直すと、その間に届いた通知とまとめて取り出せる
	q.add(ordersChangedChannel, other+" "+a.String())
	q.requeue(changeSet{orderIDs: map[uuid.UUID]struct{}{a: {}, b: {}}})
	<-q.wake
	s := q.take()
	if s.allOrders || len(s.orderIDs) != 2 {
		t.Fatalf("take() = %+v; want orders a and b", s)
	}

	// 全注文の読み直しに失敗したら、全注文を配り直すよう積み直す
	q.requeue(changeSet{allOrders: true})
	if s := q.take(); !s.allOrders || s.masterState || s.cashierState {
		t.Fatalf("take() = %+v; want all orders only", s)
	}
}
