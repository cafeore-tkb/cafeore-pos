package handlers

import (
	"bytes"
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
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
	"cafeore-pos/api/internal/notify"
)

// 注文の API と CaOS の盤面の API を、本物の Postgres を使って HTTP で通す。
// CAOS_TEST_DATABASE_URL を渡したときだけ動く（空の DB を渡すこと。表を作り直す）。

type caosEnv struct {
	db     *gorm.DB
	router *gin.Engine
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
		&models.OrderMenu{}, &models.StockResource{}, &models.ItemStockUsage{}, &models.StockEvent{}))
	sql, err := os.ReadFile("../../sql/2026-10_caos.sql")
	mustDo(t, err)
	mustDo(t, db.Exec(string(sql)).Error)
	mustDo(t, db.Exec("TRUNCATE caos_drips, caos_boards, order_menus, comments, orders, menu_items, menus, items, item_types, stock_events, item_stock_usages, stock_resources").Error)

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
	store := caos.NewStore(db)
	orders := NewOrderHandler(db, hub, NewInventory(db, notify.NewSlack(""), RemindAuth{}, ""), store)
	c := NewCaosHandler(store, hub, orders)
	r := gin.New()
	r.POST("/api/orders", orders.CreateOrder)
	r.GET("/api/orders/:id", orders.GetOrder)
	r.PATCH("/api/orders/:id/ready", orders.MarkOrderReady)
	r.DELETE("/api/orders/:id", orders.DeleteOrder)
	r.GET("/api/caos/boards/:day", c.GetBoard)
	r.POST("/api/caos/boards/:day/ops", c.ApplyOp)
	return &caosEnv{db: db, router: r, menu: menu.ID}
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

func TestCaosThroughHTTP(t *testing.T) {
	e := newCaosEnv(t)
	day := caos.Day(time.Now())
	o := e.createOrder(t, 1, 1)

	var board caos.Snapshot
	if code := e.call(t, http.MethodGet, "/api/caos/boards/"+day, nil, &board); code != http.StatusOK || len(board.Drips) != 1 {
		t.Fatalf("注文を作るとカードができている：%d %+v", code, board)
	}
	card := board.Drips[0]

	var res caos.Result
	op := func(body map[string]any) int {
		return e.call(t, http.MethodPost, "/api/caos/boards/"+day+"/ops", body, &res)
	}
	if code := op(map[string]any{"name": "assign", "drip_id": card.ID, "dripper": 1}); code != http.StatusOK || res.Changed[0].Status != caos.StatusBrewing {
		t.Fatalf("割当：%d %+v", code, res)
	}
	if code := op(map[string]any{"name": "next", "dripper": 1}); code != http.StatusOK || len(res.Readied) != 1 {
		t.Fatalf("次へで準備完了：%d %+v", code, res)
	}
	var after models.OrderResponse
	e.call(t, http.MethodGet, "/api/orders/"+o.Id.String(), nil, &after)
	if after.ReadyAt == nil {
		t.Fatal("POS の注文に ready_at が付く")
	}
	if code := op(map[string]any{"name": "next", "dripper": 1}); code != http.StatusUnprocessableEntity {
		t.Fatalf("ルールに合わない操作は 422：%d", code)
	}
	if code := e.call(t, http.MethodGet, "/api/caos/boards/2026-13-01", nil, nil); code != http.StatusUnprocessableEntity {
		t.Fatalf("日付の形が違えば 422：%d", code)
	}

	// POS で準備完了にすると、抽出中のカードが終わる
	o2 := e.createOrder(t, 2, 1)
	e.call(t, http.MethodGet, "/api/caos/boards/"+day, nil, &board)
	for _, d := range board.Drips {
		if d.Status == caos.StatusUnassigned {
			op(map[string]any{"name": "assign", "drip_id": d.ID, "dripper": 2})
		}
	}
	e.call(t, http.MethodPatch, "/api/orders/"+o2.Id.String()+"/ready", nil, nil)
	e.call(t, http.MethodGet, "/api/caos/boards/"+day, nil, &board)
	for _, d := range board.Drips {
		if d.Status != caos.StatusDone {
			t.Fatalf("POS の準備完了でカードが終わる：%+v", d)
		}
	}

	// 注文を消すと、未割当のカードも消える
	o3 := e.createOrder(t, 3, 2)
	e.call(t, http.MethodDelete, "/api/orders/"+o3.Id.String(), nil, nil)
	e.call(t, http.MethodGet, "/api/caos/boards/"+day, nil, &board)
	if len(board.Drips) != 2 {
		t.Fatalf("消した注文のカードが残っている：%+v", board.Drips)
	}
}

func TestCaosFailureDoesNotBlockOrders(t *testing.T) {
	e := newCaosEnv(t)
	// CaOS の表が壊れていても（ここでは消してしまう）、POS の注文は通る
	mustDo(t, e.db.Exec("DROP TABLE caos_drips").Error)
	o := e.createOrder(t, 1, 1)
	var got models.OrderResponse
	if code := e.call(t, http.MethodGet, "/api/orders/"+o.Id.String(), nil, &got); code != http.StatusOK || len(got.Menus) != 1 {
		t.Fatalf("注文が保存されていない：%d", code)
	}
	if code := e.call(t, http.MethodPatch, "/api/orders/"+o.Id.String()+"/ready", nil, &got); code != http.StatusOK || got.ReadyAt == nil {
		t.Fatalf("準備完了も通る：%d", code)
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

// 同じ注文に「POS で準備完了」と「CaOS で次へ」を同時にぶつけても、デッドロックせず両方とも処理される
// （ロックの順番を、どちらも 盤面 → 注文 にそろえている）。
func TestCaosConcurrentReadyAndNextDoNotDeadlock(t *testing.T) {
	e := newCaosEnv(t)
	logs := captureLog(t)
	day := caos.Day(time.Now())
	for i := range 20 {
		o := e.createOrder(t, 100+i, 1)
		var board caos.Snapshot
		e.call(t, http.MethodGet, "/api/caos/boards/"+day, nil, &board)
		for _, d := range board.Drips {
			if d.Status == caos.StatusUnassigned {
				e.call(t, http.MethodPost, "/api/caos/boards/"+day+"/ops", map[string]any{"name": "assign", "drip_id": d.ID, "dripper": 1}, nil)
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
			codes[1] = e.call(t, http.MethodPost, "/api/caos/boards/"+day+"/ops", map[string]any{"name": "next", "dripper": 1}, nil)
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
// 打ち切りは savepoint の中のエラーなので、戻せば注文の tx は続けられる。ロックが外れたら、盤面を読んだときに追いつく。
func TestCaosLockTimeoutDoesNotBlockOrders(t *testing.T) {
	e := newCaosEnvWith(t, "-c lock_timeout=300ms")
	logs := captureLog(t)
	day := caos.Day(time.Now())
	mustDo(t, e.db.Exec("INSERT INTO caos_boards (day) VALUES (?) ON CONFLICT DO NOTHING", day).Error)

	holder := e.db.Begin()
	mustDo(t, holder.Exec("SELECT * FROM caos_boards WHERE day = ? FOR UPDATE", day).Error)
	o := e.createOrder(t, 1, 1)
	if !strings.Contains(logs.String(), "lock timeout") || !strings.Contains(logs.String(), "skipped syncing") {
		t.Fatalf("ロック待ちの打ち切りのあと、カードの連動を飛ばしていない：%s", logs.String())
	}
	// ロックが取れなかったので、注文の行を書いたあとに盤面をロックしに行かない（逆の順番にしない）
	if strings.Contains(logs.String(), "failed to sync") {
		t.Fatalf("ロックが取れないのに連動しようとした：%s", logs.String())
	}
	var got models.OrderResponse
	if code := e.call(t, http.MethodGet, "/api/orders/"+o.Id.String(), nil, &got); code != http.StatusOK || len(got.Menus) != 1 {
		t.Fatalf("注文が保存されていない：%d", code)
	}
	mustDo(t, holder.Rollback().Error)

	var board caos.Snapshot
	if e.call(t, http.MethodGet, "/api/caos/boards/"+day, nil, &board); len(board.Drips) != 1 {
		t.Fatalf("ロックが外れたら、読んだときにカードが追いつく：%+v", board.Drips)
	}
}

// POS の「準備完了」は、盤面のロックを取ったあとの注文の状態で切り替える。
// ロックを待っている間に CaOS（の「次へ」）が準備完了にしていたら、それを古い状態で上書きせず、そこから切り替える。
func TestCaosReadyToggleUsesStateAfterLock(t *testing.T) {
	e := newCaosEnv(t)
	day := caos.Day(time.Now())
	o := e.createOrder(t, 1, 1)

	holder := e.db.Begin()
	mustDo(t, holder.Exec("SELECT * FROM caos_boards WHERE day = ? FOR UPDATE", day).Error)
	done := make(chan int, 1)
	go func() { done <- e.call(t, http.MethodPatch, "/api/orders/"+o.Id.String()+"/ready", nil, nil) }()
	time.Sleep(300 * time.Millisecond) // 準備完了のリクエストが盤面のロックを待っている
	mustDo(t, holder.Exec("UPDATE orders SET ready_at = now() WHERE id = ?", o.Id).Error)
	mustDo(t, holder.Commit().Error)

	if code := <-done; code != http.StatusOK {
		t.Fatalf("準備完了が通らない：%d", code)
	}
	var got models.OrderResponse
	e.call(t, http.MethodGet, "/api/orders/"+o.Id.String(), nil, &got)
	if got.ReadyAt != nil {
		t.Fatalf("ロックのあとの状態（準備完了）から切り替わるはず（未完了に戻る）：%v", got.ReadyAt)
	}
}
