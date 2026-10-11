package handlers

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/models"
)

// グッズだけの注文（カップが1つもできない注文）を、作成・編集のときに提供済みにする（Issue #733）。
// POST / PUT /api/orders を本物の Postgres で通す。TEST_DATABASE_URL を渡したときだけ動く。
// 渡した DB の中身には触らず、テストごとに使い捨ての schema を作って終わったら消すので、
// ほかの DB のテストと同じ DB を指しても壊し合わない。
//
//	TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres go test ./internal/handlers/ -run GoodsOnly
//
// TODO: #790 がマージされたら、この準備は #790 の api/internal/testdb（testdb.New）に寄せる
// （TEST_DATABASE_URL を読む・無ければスキップ・CI では落とす、の決まりも testdb にまとまっている）。
// 今はまだ testdb が無いので、ここで同じ形の準備をしている。CI に Postgres が無いうちは落とさずスキップする。

type orderDBEnv struct {
	t  *testing.T
	db *gorm.DB
}

func newOrderDBEnv(t *testing.T) *orderDBEnv {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL がないので、DB を使うテストは飛ばす")
	}
	e := &orderDBEnv{t: t, db: openTestSchema(t, dsn)}
	e.must(e.db.AutoMigrate(models.All()...))
	return e
}

// テストごとに使い捨ての schema を作って開き、終わったら消す。uuid_generate_v4() は DB の public に入れ、
// search_path を「その schema,public」にして使う（#790 の testdb.New と同じ形）。
func openTestSchema(t *testing.T, dsn string) *gorm.DB {
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

func (e *orderDBEnv) must(err error) {
	e.t.Helper()
	if err != nil {
		e.t.Fatal(err)
	}
}

func (e *orderDBEnv) itemType(name string) models.ItemType {
	e.t.Helper()
	it := models.ItemType{Name: name, DisplayName: name}
	e.must(e.db.Create(&it).Error)
	return it
}

// カップを作らない種類（グッズ）。種類の名前ではなく makes_cup で見分けるので、名前は others でなくてよい。
func (e *orderDBEnv) goodsType(name string) models.ItemType {
	e.t.Helper()
	it := models.ItemType{Name: name, DisplayName: name, MakesCup: boolPtr(false), NeedsBrew: boolPtr(false)}
	e.must(e.db.Create(&it).Error)
	return it
}

func (e *orderDBEnv) item(name string, typ models.ItemType) models.Item {
	e.t.Helper()
	item := models.Item{Name: name, Abbr: name, ItemTypeID: typ.ID}
	e.must(e.db.Create(&item).Error)
	return item
}

func (e *orderDBEnv) menu(key string, items ...models.MenuItem) models.Menu {
	e.t.Helper()
	menu := models.Menu{Name: key, Abbr: key, Price: 500, Key: key}
	e.must(e.db.Create(&menu).Error)
	for _, mi := range items {
		mi.MenuID = menu.ID
		e.must(e.db.Create(&mi).Error)
	}
	return menu
}

func (e *orderDBEnv) orderAPI() *gin.Engine {
	e.t.Helper()
	gin.SetMode(gin.TestMode)
	hub := NewHub()
	go hub.Run()
	h := NewOrderHandler(e.db, hub, nil)
	r := gin.New()
	r.POST("/api/orders", h.CreateOrder)
	r.PUT("/api/orders/:id", h.UpdateOrder)
	return r
}

func (e *orderDBEnv) sendOrder(r *gin.Engine, method, path string, body any, wantStatus int) models.OrderResponse {
	e.t.Helper()
	data, err := json.Marshal(body)
	e.must(err)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(method, path, bytes.NewReader(data)))
	if w.Code != wantStatus {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, w.Code, wantStatus, w.Body.String())
	}
	var resp models.OrderResponse
	e.must(json.Unmarshal(w.Body.Bytes(), &resp))
	return resp
}

func menuLines(menus ...models.Menu) []models.MenuInfoCreate {
	lines := make([]models.MenuInfoCreate, len(menus))
	for i, menu := range menus {
		lines[i] = models.MenuInfoCreate{MenuId: menu.ID}
	}
	return lines
}

// 編集のリクエスト。既存の明細は ID を付けて引き継ぐ。
func updateRequest(resp models.OrderResponse, added ...models.Menu) models.OrderUpdateRequest {
	lines := make([]models.MenuInfoCreate, 0, len(resp.Menus)+len(added))
	for _, m := range resp.Menus {
		orderMenuID := m.Id
		lines = append(lines, models.MenuInfoCreate{MenuId: m.Menu.Id, OrderMenuId: &orderMenuID})
	}
	lines = append(lines, menuLines(added...)...)
	return models.OrderUpdateRequest{
		Id: resp.Id, OrderId: resp.OrderId, BillingAmount: resp.BillingAmount, Received: resp.Received,
		ReadyAt: resp.ReadyAt, ServedAt: resp.ServedAt, MenuIds: lines,
	}
}

func TestCreateOrderServesGoodsOnlyOrder(t *testing.T) {
	e := newOrderDBEnv(t)
	r := e.orderAPI()
	hot, milk, goodsType := e.itemType("hot"), e.itemType("milk"), e.goodsType("物販")
	blend, iceMilk, bag := e.item("ブレンド", hot), e.item("アイスミルク", milk), e.item("ドリップバッグ", goodsType)
	goods := e.menu("goods", models.MenuItem{ItemID: bag.ID, Quantity: 2})
	coffee := e.menu("coffee", models.MenuItem{ItemID: blend.ID, Quantity: 1})
	set := e.menu("set", models.MenuItem{ItemID: bag.ID, Quantity: 1}, models.MenuItem{ItemID: iceMilk.ID, Quantity: 1})

	// グッズだけ（カップを作らない種類だけ）の注文は、作った時点で準備完了・提供済み
	resp := e.sendOrder(r, http.MethodPost, "/api/orders", models.OrderCreateRequest{OrderId: 1, BillingAmount: 500, Received: 500, MenuIds: menuLines(goods, goods)}, http.StatusCreated)
	if len(resp.Cups) != 0 {
		t.Fatalf("goods only order must not have cups: %+v", resp.Cups)
	}
	if !sameTime(resp.ReadyAt, &resp.CreatedAt) || !sameTime(resp.ServedAt, &resp.CreatedAt) {
		t.Fatalf("goods only order must be served at created_at: ready=%v served=%v created=%v", resp.ReadyAt, resp.ServedAt, resp.CreatedAt)
	}

	// 飲み物のある注文、グッズとカップを作る種類（抽出しないミルクも）のセットは準備中のまま
	for _, menus := range [][]models.Menu{{goods, coffee}, {set}} {
		resp := e.sendOrder(r, http.MethodPost, "/api/orders", models.OrderCreateRequest{OrderId: 2, BillingAmount: 500, Received: 500, MenuIds: menuLines(menus...)}, http.StatusCreated)
		if len(resp.Cups) != 1 || resp.ReadyAt != nil || resp.ServedAt != nil {
			t.Fatalf("order with a cup must be preparing: cups=%d ready=%v served=%v", len(resp.Cups), resp.ReadyAt, resp.ServedAt)
		}
	}
}

func TestUpdateOrderServesOrderThatBecomesGoodsOnly(t *testing.T) {
	e := newOrderDBEnv(t)
	r := e.orderAPI()
	hot, goodsType := e.itemType("hot"), e.goodsType("物販")
	blend, bag := e.item("ブレンド", hot), e.item("ドリップバッグ", goodsType)
	goods := e.menu("goods", models.MenuItem{ItemID: bag.ID, Quantity: 1})
	coffee := e.menu("coffee", models.MenuItem{ItemID: blend.ID, Quantity: 1})

	// グッズだけの注文に飲み物を足すと、カップができて準備中に戻る
	resp := e.sendOrder(r, http.MethodPost, "/api/orders", models.OrderCreateRequest{OrderId: 1, BillingAmount: 500, Received: 500, MenuIds: menuLines(goods)}, http.StatusCreated)
	resp = e.sendOrder(r, http.MethodPut, "/api/orders/"+resp.Id.String(), updateRequest(resp, coffee), http.StatusOK)
	if len(resp.Cups) != 1 || resp.ReadyAt != nil || resp.ServedAt != nil {
		t.Fatalf("order with an added drink must be preparing: cups=%d ready=%v served=%v", len(resp.Cups), resp.ReadyAt, resp.ServedAt)
	}

	// 飲み物を外してグッズだけにすると、提供済みになる
	req := updateRequest(resp)
	for _, line := range req.MenuIds {
		if line.MenuId == goods.ID {
			req.MenuIds = []models.MenuInfoCreate{line}
		}
	}
	resp = e.sendOrder(r, http.MethodPut, "/api/orders/"+resp.Id.String(), req, http.StatusOK)
	if len(resp.Cups) != 0 || resp.ReadyAt == nil || resp.ServedAt == nil {
		t.Fatalf("order that becomes goods only must be served: cups=%d ready=%v served=%v", len(resp.Cups), resp.ReadyAt, resp.ServedAt)
	}

	// 提供済みのグッズだけの注文を編集しても、提供の時刻は変わらない
	servedAt := *resp.ServedAt
	resp = e.sendOrder(r, http.MethodPut, "/api/orders/"+resp.Id.String(), updateRequest(resp), http.StatusOK)
	if !sameTime(resp.ServedAt, &servedAt) {
		t.Fatalf("served goods only order must keep served_at: %v, want %v", resp.ServedAt, servedAt)
	}
}
