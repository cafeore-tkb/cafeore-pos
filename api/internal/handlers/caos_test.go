package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

// 注文の API と CaOS の操作の API・配信を、本物の Postgres を使って HTTP と WebSocket で通す。
// CAOS_TEST_DATABASE_URL を渡したときだけ動く（空の DB を渡すこと。表を作り直す）。

type caosEnv struct {
	db     *gorm.DB
	dsn    string
	router *gin.Engine
	orders *OrderHandler
	store  *caos.Store
	menu   uuid.UUID
}

func newCaosEnv(t *testing.T) *caosEnv { return newCaosEnvWith(t, "") }

// newCaosEnvWith は、接続文字列に Postgres の設定（options）を足して作る。
func newCaosEnvWith(t *testing.T, options string) *caosEnv {
	t.Helper()
	dsn := os.Getenv("CAOS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("CAOS_TEST_DATABASE_URL がないので、DB を使うテストは飛ばす")
	}
	if options != "" {
		sep := "?"
		if strings.Contains(dsn, "?") {
			sep = "&"
		}
		dsn += sep + "options=" + url.QueryEscape(options)
	}
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{Logger: logger.Discard})
	if err != nil {
		t.Fatal(err)
	}
	mustDo(t, db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error)
	mustDo(t, db.AutoMigrate(&models.ItemType{}, &models.Item{}, &models.Menu{}, &models.MenuItem{}, &models.Order{}, &models.Comment{},
		&models.OrderMenu{}, &models.OrderCup{}, &models.MasterState{}, &models.StockResource{}, &models.ItemStockUsage{}, &models.StockEvent{}))
	mustDo(t, db.Exec("DROP TABLE IF EXISTS caos_drips, caos_lanes, caos_ops, caos_practices").Error)
	mustDo(t, db.AutoMigrate(caos.Models()...))
	mustDo(t, db.Exec("TRUNCATE caos_drips, caos_lanes, caos_ops, order_cups, order_menus, comments, orders, menu_items, menus, items, item_types, stock_events, item_stock_usages, stock_resources").Error)

	hot := models.ItemType{Name: "hot", DisplayName: "ホット"}
	mustDo(t, db.Create(&hot).Error)
	item := models.Item{Name: "優勝ブレンド", Abbr: "優勝", ItemTypeID: hot.ID}
	mustDo(t, db.Create(&item).Error)
	menu := models.Menu{Name: "優勝ブレンド", Abbr: "優勝", Price: 500, Key: "champ"}
	mustDo(t, db.Create(&menu).Error)
	mustDo(t, db.Create(&models.MenuItem{MenuID: menu.ID, ItemID: item.ID, Quantity: 1}).Error)

	gin.SetMode(gin.TestMode)
	hub := NewHub()
	go hub.Run()
	store := caos.NewStore(db, SetOrderReady)
	orders := NewOrderHandler(db, hub, NewInventory(db, notify.NewSlack(""), RemindAuth{}, ""), store)
	c := NewCaosHandler(store, orders)
	r := gin.New()
	r.GET("/api/ws/orders", orders.WSHandler)
	r.POST("/api/orders", orders.CreateOrder)
	r.GET("/api/orders/:id", orders.GetOrder)
	r.PUT("/api/orders/:id", orders.UpdateOrder)
	r.PATCH("/api/orders/:id/ready", orders.MarkOrderReady)
	r.PATCH("/api/orders/:id/served", orders.MarkOrderServed)
	r.PATCH("/api/orders/:id/cups/:cupId/ready", orders.MarkOrderCupReady)
	r.DELETE("/api/orders/:id", orders.DeleteOrder)
	r.POST("/api/caos/ops", c.ApplyOp)
	p := NewCaosPracticeHandler(caos.NewPracticeStore(db))
	r.POST("/api/caos/practice", p.Create)
	r.GET("/api/caos/practice/:id", p.Get)
	r.POST("/api/caos/practice/:id/advance", p.Advance)
	r.POST("/api/caos/practice/:id/ops", p.ApplyOp)
	r.DELETE("/api/caos/practice/:id", p.Delete)
	return &caosEnv{db: db, dsn: dsn, router: r, orders: orders, store: store, menu: menu.ID}
}

func mustDo(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func (e *caosEnv) call(t *testing.T, method, path string, body any, out any) int {
	t.Helper()
	var buf bytes.Buffer
	if body != nil {
		mustDo(t, json.NewEncoder(&buf).Encode(body))
	}
	req := httptest.NewRequest(method, path, &buf)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	e.router.ServeHTTP(w, req)
	if out != nil && w.Code < 300 {
		mustDo(t, json.Unmarshal(w.Body.Bytes(), out))
	}
	return w.Code
}

func (e *caosEnv) createOrder(t *testing.T, no, cups int) models.OrderResponse {
	t.Helper()
	menus := make([]map[string]any, cups)
	for i := range menus {
		menus[i] = map[string]any{"menu_id": e.menu}
	}
	var o models.OrderResponse
	if code := e.call(t, http.MethodPost, "/api/orders", map[string]any{"order_id": no, "billing_amount": 500, "received": 500, "menu_ids": menus}, &o); code != http.StatusCreated {
		t.Fatalf("注文を作れない：%d", code)
	}
	return o
}

func (e *caosEnv) cards(t *testing.T) []caos.Drip {
	t.Helper()
	d, err := e.store.Drips(e.store.Today())
	mustDo(t, err)
	return d
}

func (e *caosEnv) op(t *testing.T, body map[string]any, out *caos.Result) int {
	t.Helper()
	if out == nil {
		return e.call(t, http.MethodPost, "/api/caos/ops", body, nil)
	}
	return e.call(t, http.MethodPost, "/api/caos/ops", body, out)
}

func (e *caosEnv) order(t *testing.T, id uuid.UUID) models.OrderResponse {
	t.Helper()
	var o models.OrderResponse
	if code := e.call(t, http.MethodGet, "/api/orders/"+id.String(), nil, &o); code != http.StatusOK {
		t.Fatalf("注文が読めない：%d", code)
	}
	return o
}

// 盤面のロック（その日の advisory lock）を、ほかの処理として持つ
func (e *caosEnv) holdBoard(t *testing.T) *gorm.DB {
	t.Helper()
	holder := e.db.Begin()
	mustDo(t, holder.Exec("SELECT pg_advisory_xact_lock(hashtext(?))", "caos:"+e.store.Today()).Error)
	return holder
}

func TestCaosThroughHTTP(t *testing.T) {
	e := newCaosEnv(t)
	o := e.createOrder(t, 1, 1)
	if d := e.cards(t); len(d) != 1 || d[0].Lines[0].OrderID != o.Id.String() {
		t.Fatalf("注文を作るとカードができている：%+v", d)
	}
	card := e.cards(t)[0]

	var res caos.Result
	if code := e.op(t, map[string]any{"name": "assign", "drip_id": card.ID, "dripper": 1}, &res); code != http.StatusOK || res.Changed[0].Status != caos.StatusBrewing {
		t.Fatalf("割当：%d %+v", code, res)
	}
	if code := e.op(t, map[string]any{"name": "next", "dripper": 1}, &res); code != http.StatusOK || len(res.Readied) != 1 || res.Readied[0] != o.Id.String() {
		t.Fatalf("次へで、カードが全部終わった注文を準備完了にする：%d %+v", code, res)
	}
	if e.order(t, o.Id).ReadyAt == nil {
		t.Fatal("同じトランザクションで準備完了が付く")
	}
	// 1つ戻す：操作の ID だけを送ると、カードも準備完了もそろって戻る
	var undo caos.Result
	if code := e.op(t, map[string]any{"name": "undo", "op_id": res.OpID}, &undo); code != http.StatusOK || undo.Changed[0].Status != caos.StatusBrewing || e.order(t, o.Id).ReadyAt != nil {
		t.Fatalf("1つ戻す：%d %+v", code, undo)
	}
	if code := e.op(t, map[string]any{"name": "undo", "op_id": res.OpID}, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("同じ操作は 2 回戻せない（422）：%d", code)
	}
	e.op(t, map[string]any{"name": "next", "dripper": 1}, nil)
	if code := e.op(t, map[string]any{"name": "next", "dripper": 1}, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("ルールに合わない操作は 422：%d", code)
	}

	// POS で準備完了にすると、抽出中のカードが終わる（体なしは今までどおりの切り替え）
	o2 := e.createOrder(t, 2, 1)
	for _, d := range e.cards(t) {
		if d.Status == caos.StatusUnassigned {
			e.op(t, map[string]any{"name": "assign", "drip_id": d.ID, "dripper": 2}, nil)
		}
	}
	e.call(t, http.MethodPatch, "/api/orders/"+o2.Id.String()+"/ready", nil, nil)
	for _, d := range e.cards(t) {
		if d.Status != caos.StatusDone {
			t.Fatalf("POS の準備完了でカードが終わる：%+v", d)
		}
	}
	if e.call(t, http.MethodPatch, "/api/orders/"+o2.Id.String()+"/ready", nil, nil); e.order(t, o2.Id).ReadyAt != nil {
		t.Fatal("PATCH は今までどおり切り替える")
	}

	// 注文を消すと、未割当のカードも消える
	o3 := e.createOrder(t, 3, 2)
	e.call(t, http.MethodDelete, "/api/orders/"+o3.Id.String(), nil, nil)
	if d := e.cards(t); len(d) != 2 {
		t.Fatalf("消した注文のカードが残っている：%+v", d)
	}
}

// CaOS の準備完了は、POS の PATCH /ready と同じくカップにも付く。1つ戻すと、その操作で付いたカップだけ外れる
// （先にカップ単位で付けていた準備完了は残る）。カップ単位で全部付けたときも、カードが終わる。
func TestCaosReadyFollowsCups(t *testing.T) {
	e := newCaosEnv(t)
	o := e.createOrder(t, 1, 2)
	if len(o.Cups) != 2 {
		t.Fatalf("2 杯の注文：%+v", o.Cups)
	}
	if code := e.call(t, http.MethodPatch, "/api/orders/"+o.Id.String()+"/cups/"+o.Cups[0].Id.String()+"/ready", nil, nil); code != http.StatusOK {
		t.Fatalf("カップの準備完了：%d", code)
	}
	early := e.order(t, o.Id).Cups[0].ReadyAt
	for _, d := range e.cards(t) {
		e.op(t, map[string]any{"name": "assign", "drip_id": d.ID, "dripper": 1}, nil)
	}
	var res caos.Result
	if code := e.op(t, map[string]any{"name": "next", "dripper": 1}, &res); code != http.StatusOK || len(res.Readied) != 1 {
		t.Fatalf("次へで準備完了：%d %+v", code, res)
	}
	got := e.order(t, o.Id)
	if got.ReadyAt == nil || !got.Cups[0].ReadyAt.Equal(*early) || !got.Cups[1].ReadyAt.Equal(*got.ReadyAt) {
		t.Fatalf("まだのカップにだけ同じ時刻が付く：%v %v %v", got.ReadyAt, got.Cups[0].ReadyAt, got.Cups[1].ReadyAt)
	}
	if code := e.op(t, map[string]any{"name": "undo", "op_id": res.OpID}, nil); code != http.StatusOK {
		t.Fatalf("1つ戻す：%d", code)
	}
	got = e.order(t, o.Id)
	if got.ReadyAt != nil || got.Cups[0].ReadyAt == nil || got.Cups[1].ReadyAt != nil {
		t.Fatalf("その操作で付いたカップだけ外れる：%v %v %v", got.ReadyAt, got.Cups[0].ReadyAt, got.Cups[1].ReadyAt)
	}

	// 残りのカップも POS でカップ単位に付けると、注文が準備完了になり、カードも終わる
	if code := e.call(t, http.MethodPatch, "/api/orders/"+o.Id.String()+"/cups/"+o.Cups[1].Id.String()+"/ready", nil, nil); code != http.StatusOK {
		t.Fatalf("カップの準備完了：%d", code)
	}
	if e.order(t, o.Id).ReadyAt == nil {
		t.Fatal("全カップがそろうと注文も準備完了")
	}
	for _, d := range e.cards(t) {
		if d.Status != caos.StatusDone {
			t.Fatalf("カップ単位の準備完了でもカードが終わる：%+v", d)
		}
	}
}

func TestCaosFailureDoesNotBlockOrders(t *testing.T) {
	e := newCaosEnv(t)
	// CaOS の表が壊れていても（ここでは消してしまう）、POS の注文は通る
	mustDo(t, e.db.Exec("DROP TABLE caos_drips").Error)
	o := e.createOrder(t, 1, 1)
	if got := e.order(t, o.Id); len(got.Menus) != 1 {
		t.Fatal("注文が保存されていない")
	}
	var got models.OrderResponse
	if code := e.call(t, http.MethodPatch, "/api/orders/"+o.Id.String()+"/ready", nil, &got); code != http.StatusOK || got.ReadyAt == nil {
		t.Fatalf("準備完了も通る：%d", code)
	}
}

// 配信は注文と同じく DB の通知から：API を通さずに caos_drips を書き換えても、各インスタンスが DB から読み直して
// 今日のカードを全部配る。つないだ直後と、ほかのインスタンスから通知が来たときに届く。
func TestCaosDripsAreBroadcastFromDB(t *testing.T) {
	e := newCaosEnv(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go e.orders.ListenOrderChanges(ctx, e.dsn)

	e.createOrder(t, 1, 1)
	srv := httptest.NewServer(e.router)
	defer srv.Close()
	conn, resp, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http")+"/api/ws/orders", nil)
	mustDo(t, err)
	defer func() { _ = conn.Close() }()
	if resp.Body != nil {
		_ = resp.Body.Close()
	}
	nextDrips := func() []caos.Drip {
		t.Helper()
		mustDo(t, conn.SetReadDeadline(time.Now().Add(5*time.Second)))
		for {
			var msg WSMessage
			mustDo(t, conn.ReadJSON(&msg))
			if msg.Type == WSMessageTypeDrips {
				return msg.Drips
			}
		}
	}
	if d := nextDrips(); len(d) != 1 || d[0].Status != caos.StatusUnassigned {
		t.Fatalf("つないだ直後に今日のカードが届く：%+v", d)
	}

	time.Sleep(200 * time.Millisecond) // LISTEN が始まるのを待つ
	// ほかのインスタンスがカードを変えて知らせてきたら、DB から読み直して配る
	mustDo(t, e.db.Exec("UPDATE caos_drips SET status = 'queued', dripper = 3").Error)
	mustDo(t, e.db.Exec("SELECT pg_notify(?, ?)", caos.ChangedChannel, "another-instance").Error)
	for {
		if d := nextDrips(); len(d) == 1 && d[0].Status == caos.StatusQueued {
			break
		}
	}

	// CaOS で操作すると、自分の画面へ配ったうえで、ほかのインスタンスへ通知を送る（自分が受けても配り直さない）
	listen, err := pgx.Connect(context.Background(), e.dsn)
	mustDo(t, err)
	defer func() { _ = listen.Close(context.Background()) }()
	_, err = listen.Exec(context.Background(), "LISTEN "+caos.ChangedChannel)
	mustDo(t, err)
	e.op(t, map[string]any{"name": "unassign", "drip_id": e.cards(t)[0].ID}, nil)
	waitCtx, stop := context.WithTimeout(context.Background(), 5*time.Second)
	defer stop()
	n, err := listen.WaitForNotification(waitCtx)
	mustDo(t, err)
	if n.Payload != instanceID {
		t.Fatalf("通知には送ったインスタンスの ID が載る：%q", n.Payload)
	}
}

// 同じ注文に「POS で準備完了」と「CaOS で次へ」を同時にぶつけても、デッドロックせず両方とも処理される
// （ロックの順番を、どちらも 盤面 → 注文 にそろえている）。
func TestCaosConcurrentReadyAndNextDoNotDeadlock(t *testing.T) {
	e := newCaosEnv(t)
	logs := captureLog(t)
	for i := range 20 {
		o := e.createOrder(t, 100+i, 1)
		for _, d := range e.cards(t) {
			if d.Status == caos.StatusUnassigned {
				e.op(t, map[string]any{"name": "assign", "drip_id": d.ID, "dripper": 1}, nil)
			}
		}
		var wg sync.WaitGroup
		codes := make([]int, 2)
		wg.Add(2)
		go func() {
			defer wg.Done()
			codes[0] = e.call(t, http.MethodPatch, "/api/orders/"+o.Id.String()+"/ready", nil, nil)
		}()
		go func() {
			defer wg.Done()
			codes[1] = e.op(t, map[string]any{"name": "next", "dripper": 1}, nil)
		}()
		wg.Wait()
		// 次へは、先に POS の準備完了でカードが終わっていれば 422（抽出中ではない）になる
		if codes[0] != http.StatusOK || (codes[1] != http.StatusOK && codes[1] != http.StatusUnprocessableEntity) {
			t.Fatalf("同時に処理できない：ready=%d next=%d", codes[0], codes[1])
		}
	}
	if strings.Contains(logs.String(), "caos:") {
		t.Fatalf("CaOS の処理が失敗した：%s", logs.String())
	}
}

// 盤面のロックをほかの処理が持ったままでも、POS の注文は（ロック待ちの打ち切りのあと）通る。
// ロックが取れなければカードの連動は飛ばし、次に CaOS で操作したときに追いつく。
func TestCaosLockTimeoutDoesNotBlockOrders(t *testing.T) {
	e := newCaosEnvWith(t, "-c lock_timeout=300ms")
	logs := captureLog(t)
	holder := e.holdBoard(t)
	o := e.createOrder(t, 1, 1)
	if !strings.Contains(logs.String(), "lock timeout") || !strings.Contains(logs.String(), "skipped syncing") {
		t.Fatalf("ロック待ちの打ち切りのあと、カードの連動を飛ばしていない：%s", logs.String())
	}
	if strings.Contains(logs.String(), "failed to sync") {
		t.Fatalf("ロックが取れないのに連動しようとした：%s", logs.String())
	}
	if got := e.order(t, o.Id); len(got.Menus) != 1 {
		t.Fatal("注文が保存されていない")
	}
	mustDo(t, holder.Rollback().Error)

	if len(e.cards(t)) != 0 {
		t.Fatal("連動を飛ばしたので、まだカードはない")
	}
	o2 := e.createOrder(t, 2, 1)
	e.op(t, map[string]any{"name": "assign", "drip_id": e.cards(t)[0].ID, "dripper": 1}, nil)
	var orders []string
	for _, d := range e.cards(t) {
		orders = append(orders, d.OrderIDs...)
	}
	joined := strings.Join(orders, ",")
	if len(orders) != 2 || !strings.Contains(joined, o.Id.String()) || !strings.Contains(joined, o2.Id.String()) {
		t.Fatalf("CaOS で操作したときに、連動しそこねたカードが追いつく：%v", orders)
	}
}

// POS の「準備完了」は、盤面のロックを取ったあとの注文の状態で切り替える。
// ロックを待っている間にほかの端末が準備完了にしていたら、それを古い状態で上書きせず、そこから切り替える。
func TestCaosReadyToggleUsesStateAfterLock(t *testing.T) {
	e := newCaosEnv(t)
	o := e.createOrder(t, 1, 1)
	holder := e.holdBoard(t)
	done := make(chan int, 1)
	go func() { done <- e.call(t, http.MethodPatch, "/api/orders/"+o.Id.String()+"/ready", nil, nil) }()
	time.Sleep(300 * time.Millisecond) // 準備完了のリクエストが盤面のロックを待っている
	mustDo(t, holder.Exec("UPDATE orders SET ready_at = now() WHERE id = ?", o.Id).Error)
	mustDo(t, holder.Commit().Error)
	if code := <-done; code != http.StatusOK {
		t.Fatalf("準備完了が通らない：%d", code)
	}
	if got := e.order(t, o.Id); got.ReadyAt != nil {
		t.Fatalf("ロックのあとの状態（準備完了）から切り替わるはず（未完了に戻る）：%v", got.ReadyAt)
	}
}

// PUT の体（POS の画面の orderToUpdateRequest と同じ形）。明細は今のものを引き継ぐ
func putBody(o models.OrderResponse, readyAt, servedAt *time.Time) map[string]any {
	menus := make([]map[string]any, len(o.Menus))
	for i, m := range o.Menus {
		menus[i] = map[string]any{"menu_id": m.Menu.Id, "order_menu_id": m.Id}
	}
	return map[string]any{"order_id": o.OrderId, "billing_amount": o.BillingAmount, "received": o.Received,
		"ready_at": readyAt, "served_at": servedAt, "menu_ids": menus}
}

// 古い画面から（未完了のまま）編集しても、CaOS が付けた準備完了は消えない（カップのある注文の状態はカップから決まる）。
// 提供済みにすると（PATCH /served）、カードも終わる。
func TestCaosPutKeepsReady(t *testing.T) {
	e := newCaosEnv(t)
	o := e.createOrder(t, 1, 1)
	e.op(t, map[string]any{"name": "assign", "drip_id": e.cards(t)[0].ID, "dripper": 1}, nil)
	e.op(t, map[string]any{"name": "next", "dripper": 1}, nil) // 準備完了になる

	var got models.OrderResponse
	if code := e.call(t, http.MethodPut, "/api/orders/"+o.Id.String(), putBody(o, nil, nil), &got); code != http.StatusOK || got.ReadyAt == nil {
		t.Fatalf("古い画面からの編集で準備完了が消えた：%d %v", code, got.ReadyAt)
	}
	for _, cup := range got.Cups {
		if cup.ReadyAt == nil || !cup.ReadyAt.Equal(*got.ReadyAt) {
			t.Fatalf("CaOS の準備完了はカップにも同じ時刻で付く：%v %v", cup.ReadyAt, got.ReadyAt)
		}
	}
	o2 := e.createOrder(t, 2, 1)
	if code := e.call(t, http.MethodPatch, "/api/orders/"+o2.Id.String()+"/served", nil, nil); code != http.StatusOK {
		t.Fatalf("提供済みにできない：%d", code)
	}
	for _, d := range e.cards(t) {
		if d.Status != caos.StatusDone {
			t.Fatalf("提供済みにした注文のカードが終わっていない：%+v", d)
		}
	}
}

// 盤面のロックを待っている間に注文が消されたら、準備完了・編集は 404 を返す（500 にしない）。
func TestCaosOrderDeletedWhileWaitingIs404(t *testing.T) {
	e := newCaosEnv(t)
	for _, method := range []string{http.MethodPatch, http.MethodPut} {
		o := e.createOrder(t, 1, 1)
		holder := e.holdBoard(t)
		done := make(chan int, 1)
		go func() {
			if method == http.MethodPatch {
				done <- e.call(t, method, "/api/orders/"+o.Id.String()+"/ready", nil, nil)
			} else {
				done <- e.call(t, method, "/api/orders/"+o.Id.String(), putBody(o, nil, nil), nil)
			}
		}()
		time.Sleep(300 * time.Millisecond) // リクエストが盤面のロックを待っている
		mustDo(t, holder.Exec("DELETE FROM order_cups WHERE order_id = ?", o.Id).Error)
		mustDo(t, holder.Exec("DELETE FROM order_menus WHERE order_id = ?", o.Id).Error)
		mustDo(t, holder.Exec("DELETE FROM orders WHERE id = ?", o.Id).Error)
		mustDo(t, holder.Commit().Error)
		if code := <-done; code != http.StatusNotFound {
			t.Fatalf("%s：ロックを待つ間に消された注文は 404：%d", method, code)
		}
	}
}

// syncLog は、テストの間だけ log の出力をためる（CaOS の処理が失敗したかを見る）。
type syncLog struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (l *syncLog) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.Write(p)
}

func (l *syncLog) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.buf.String()
}

func captureLog(t *testing.T) *syncLog {
	t.Helper()
	l := &syncLog{}
	log.SetOutput(l)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })
	return l
}
