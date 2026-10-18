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
		`DROP SCHEMA public CASCADE`,
		`CREATE SCHEMA public`,
		`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
	} {
		if err := db.Exec(sql).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.AutoMigrate(models.All()...); err != nil {
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
	sendNotify(t, db, ordersChangedChannel, uuid.NewString()+" "+orderID.String())
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
	sendNotify(t, db, ordersChangedChannel, uuid.NewString()+" "+orderID.String())
	msg = nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeOrderDeleted || msg.OrderID == nil || *msg.OrderID != orderID {
		t.Fatalf("broadcast = %+v, want order_deleted %s", msg, orderID)
	}

	// ほかのインスタンスの確認の通知では何も配らない
	sendNotify(t, db, ordersChangedChannel, listenProbePrefix+uuid.NewString())
	noBroadcast(t, hub)

	// 形の分からない通知なら全注文を配り直す
	sendNotify(t, db, ordersChangedChannel, "")
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeOrders {
		t.Fatalf("broadcast = %s, want orders", msg.Type)
	}
}

// channel に payload を通知する。ほかのインスタンスのふりをするときは、payload を別のインスタンス ID から始める
func sendNotify(t *testing.T, db *gorm.DB, channel, payload string) {
	t.Helper()
	if err := db.Exec("SELECT pg_notify(?, ?)", channel, payload).Error; err != nil {
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
	if w := callHandler(t, NewMasterStateHandler(db, hub, nil).UpdateMasterStatus, http.MethodPost, `{"type":"stop"}`); w.Code != http.StatusCreated {
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
	sendNotify(t, db, masterStateChangedChannel, uuid.NewString())
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
	sendNotify(t, db, cashierStateChangedChannel, uuid.NewString())
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

// 緊急（入れ直し）の取り消しは、このインスタンスで取り消したらその場で配ってほかのインスタンスへ知らせ、
// ほかのインスタンスから知らせが来たらそのまま配る（DB から読み直すものは無い）
func TestListenChangesPublishesCupEmergencyCancellations(t *testing.T) {
	db, dsn := openListenTestDB(t)
	other := listenAsOtherInstance(t, dsn, cupEmergencyCancelledChannel)
	hub := NewHub() // Run しないので、配信は hub.broadcast に溜まる
	h := NewOrderHandler(db, hub, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.ListenChanges(ctx, dsn)
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeOrders {
		t.Fatalf("first broadcast = %s, want orders", msg.Type)
	}
	cancelled := func(id uuid.UUID) {
		t.Helper()
		if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeCupEmergencyCancelled || msg.CupEmergencyID == nil || *msg.CupEmergencyID != id {
			t.Fatalf("broadcast = %+v, want cup_emergency_cancelled %s", msg, id)
		}
	}

	// このインスタンスで取り消したときは、その場で 1 回だけ配り（自分の通知では配り直さない）、ほかのインスタンスへ知らせる
	mine := uuid.New()
	publishCupEmergencyCancelled(db, hub, mine)
	cancelled(mine)
	waitCtx, cancelWait := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelWait()
	if n, err := other.WaitForNotification(waitCtx); err != nil || n.Payload != instanceID+" "+mine.String() {
		t.Fatalf("notification = %+v, %v", n, err)
	}
	noBroadcast(t, hub)

	// ほかのインスタンスで取り消したら、知らせを受けてそのまま配る
	theirs := uuid.New()
	sendNotify(t, db, cupEmergencyCancelledChannel, uuid.NewString()+" "+theirs.String())
	cancelled(theirs)

	// 形の分からない知らせは、どの入れ直しか分からないので配らない
	sendNotify(t, db, cupEmergencyCancelledChannel, uuid.NewString()+" x")
	noBroadcast(t, hub)
}

// 呼び出し催促も、このインスタンスで催促したらその場で配ってほかのインスタンスへ知らせ、
// ほかのインスタンスから知らせが来たらそのまま配る（注文は変わらないので、DB から読み直すものは無い）
func TestListenChangesPublishesOrderRecalls(t *testing.T) {
	db, dsn := openListenTestDB(t)
	other := listenAsOtherInstance(t, dsn, orderRecalledChannel)
	hub := NewHub() // Run しないので、配信は hub.broadcast に溜まる
	h := NewOrderHandler(db, hub, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.ListenChanges(ctx, dsn)
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeOrders {
		t.Fatalf("first broadcast = %s, want orders", msg.Type)
	}
	recalled := func(id uuid.UUID) {
		t.Helper()
		if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeOrderRecalled || msg.OrderID == nil || *msg.OrderID != id {
			t.Fatalf("broadcast = %+v, want order_recalled %s", msg, id)
		}
	}

	// このインスタンスで催促したときは、その場で 1 回だけ配り（自分の通知では配り直さない）、ほかのインスタンスへ知らせる
	mine := uuid.New()
	publishOrderRecalled(db, hub, mine)
	recalled(mine)
	waitCtx, cancelWait := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelWait()
	if n, err := other.WaitForNotification(waitCtx); err != nil || n.Payload != instanceID+" "+mine.String() {
		t.Fatalf("notification = %+v, %v", n, err)
	}
	noBroadcast(t, hub)

	// ほかのインスタンスで催促したら、知らせを受けてそのまま配る
	theirs := uuid.New()
	sendNotify(t, db, orderRecalledChannel, uuid.NewString()+" "+theirs.String())
	recalled(theirs)

	// 形の分からない知らせは、どの注文か分からないので配らない
	sendNotify(t, db, orderRecalledChannel, uuid.NewString()+" x")
	noBroadcast(t, hub)
}

// 代理印刷の頼みは、ほかのインスタンスから知らせが来たら DB から読み直し、まだ刷れていなければ配る。
// 刷れたという知らせは、そのまま配る
func TestListenChangesPublishesLabelPrints(t *testing.T) {
	db, dsn := openListenTestDB(t)
	other := listenAsOtherInstance(t, dsn, labelPrintRequestedChannel, labelPrintDoneChannel)
	hub := NewHub() // Run しないので、配信は hub.broadcast に溜まる
	h := NewOrderHandler(db, hub, nil)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go h.ListenChanges(ctx, dsn)
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeOrders {
		t.Fatalf("first broadcast = %s, want orders", msg.Type)
	}
	create := func() uuid.UUID {
		t.Helper()
		row := models.LabelPrintRequest{ID: uuid.New(), Job: models.JSONB(`{"labels":[{"type":"flow","lines":[]}]}`), CreatedAt: time.Now()}
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
		return row.ID
	}
	requested := func(id uuid.UUID) {
		t.Helper()
		if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeLabelPrintRequested || msg.LabelPrintRequest == nil || msg.LabelPrintRequest.Id != id || len(msg.LabelPrintRequest.Job.Labels) != 1 {
			t.Fatalf("broadcast = %+v, want label_print_requested %s", msg, id)
		}
	}

	// このインスタンスで頼まれたときは、その場で 1 回だけ配り（自分の通知では配り直さない）、ほかのインスタンスへ知らせる
	mine := create()
	publishLabelPrintRequested(db, hub, mine)
	requested(mine)
	waitCtx, cancelWait := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancelWait()
	if n, err := other.WaitForNotification(waitCtx); err != nil || n.Channel != labelPrintRequestedChannel || n.Payload != instanceID+" "+mine.String() {
		t.Fatalf("notification = %+v, %v", n, err)
	}
	publishLabelPrintDone(db, hub, mine)
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeLabelPrintDone || msg.LabelPrintRequestID == nil || *msg.LabelPrintRequestID != mine {
		t.Fatalf("broadcast = %+v, want label_print_done %s", msg, mine)
	}
	if n, err := other.WaitForNotification(waitCtx); err != nil || n.Channel != labelPrintDoneChannel || n.Payload != instanceID+" "+mine.String() {
		t.Fatalf("notification = %+v, %v", n, err)
	}
	noBroadcast(t, hub)

	// ほかのインスタンスで頼まれたら、DB から読み直して配る
	theirs := create()
	sendNotify(t, db, labelPrintRequestedChannel, uuid.NewString()+" "+theirs.String())
	requested(theirs)

	// 刷れた・無い頼みは配らない。形の分からない知らせも配らない
	if err := db.Model(&models.LabelPrintRequest{}).Where("id = ?", theirs).Update("printed_at", time.Now()).Error; err != nil {
		t.Fatal(err)
	}
	sendNotify(t, db, labelPrintRequestedChannel, uuid.NewString()+" "+theirs.String())
	sendNotify(t, db, labelPrintRequestedChannel, uuid.NewString()+" "+uuid.NewString())
	sendNotify(t, db, labelPrintRequestedChannel, uuid.NewString()+" x")
	sendNotify(t, db, labelPrintDoneChannel, uuid.NewString()+" x")
	noBroadcast(t, hub)

	// ほかのインスタンスで刷れたら、そのまま配る
	sendNotify(t, db, labelPrintDoneChannel, uuid.NewString()+" "+theirs.String())
	if msg := nextBroadcast(t, hub); msg.Type != WSMessageTypeLabelPrintDone || msg.LabelPrintRequestID == nil || *msg.LabelPrintRequestID != theirs {
		t.Fatalf("broadcast = %+v, want label_print_done %s", msg, theirs)
	}
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
