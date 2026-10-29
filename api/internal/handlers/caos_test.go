package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/models"
)

// CaOS の書き込みの DB のテスト。TEST_DATABASE_URL に Postgres の接続文字列を渡したときだけ走り、
// テストごとに使い捨ての schema を作って終わったら消す（渡した DB の中身には触らない）。
// ドリッパーの列の決まり（splitCaosLane）と、種類の名前で抽出が要るかを決めるテストは DB を使わない。
//
//	TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres go test ./internal/handlers/ -run Caos

// openCaosTestDB は使い捨ての schema に全部のテーブルを作って開く。TEST_DATABASE_URL が無ければ飛ばす。
func openCaosTestDB(t *testing.T) *gorm.DB {
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
	db := open(caosTestSearchPath(t, dsn, schema+",public"))
	if err := db.AutoMigrate(models.All()...); err != nil {
		t.Fatal(err)
	}
	return db
}

// caosTestSearchPath は接続文字列に search_path を足す（どの接続もその schema を見るように）。URL でも key=value でもよい。
func caosTestSearchPath(t *testing.T, dsn, searchPath string) string {
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

type caosFixture struct {
	// CaOS の時計を今からずらす分（wait で進める）
	skew   time.Duration
	db     *gorm.DB
	hub    *Hub
	caos   *CaosHandler
	orders *OrderHandler
	blend  models.Item
	milk   models.Item
	menu   models.Menu
}

func newCaosFixture(t *testing.T, db *gorm.DB) *caosFixture {
	t.Helper()
	hub := NewHub()
	// Run しないので、配信は hub.broadcast に溜まる。溜まりすぎて止まらないよう読み捨てる
	go func() {
		for range hub.broadcast {
		}
	}()
	f := &caosFixture{db: db, hub: hub, caos: NewCaosHandler(db, hub, nil), orders: NewOrderHandler(db, hub, nil)}
	f.caos.now = func() time.Time { return time.Now().Add(f.skew) }
	// 抽出が要るかは種類の needs_brew で決める（ミルクはカップを作るが抽出は要らない）
	hot := models.ItemType{Name: "hot", DisplayName: "ホット"}
	milk := models.ItemType{Name: "milk", DisplayName: "ミルク", NeedsBrew: boolPtr(false)}
	f.blend = models.Item{Name: "ブレンド", Abbr: "ブ", ItemType: hot}
	f.milk = models.Item{Name: "アイスミルク", Abbr: "ミ", ItemType: milk}
	f.menu = models.Menu{Name: "ブレンド", Abbr: "ブ", Price: 500, Key: "blend-" + uuid.NewString()}
	for _, v := range []any{&f.blend, &f.milk, &f.menu} {
		if err := db.Create(v).Error; err != nil {
			t.Fatal(err)
		}
	}
	return f
}

// 注文の明細（カップの商品）
func line(items ...models.Item) []models.Item { return items }

// createOrderAt は注文番号 no の注文を作る。
func (f *caosFixture) createOrderAt(t *testing.T, no int, createdAt time.Time, lines ...[]models.Item) models.Order {
	t.Helper()
	order := models.Order{ID: uuid.New(), OrderId: no, CreatedAt: createdAt, BillingAmount: 500, Received: 500}
	pos := 0
	for _, l := range lines {
		m := models.OrderMenu{ID: uuid.New(), OrderID: order.ID, MenuID: f.menu.ID, MenuName: f.menu.Name, UnitPrice: 500}
		order.OrderMenus = append(order.OrderMenus, m)
		for _, item := range l {
			order.OrderCups = append(order.OrderCups, models.OrderCup{ID: uuid.New(), OrderMenuID: m.ID, ItemID: item.ID, Position: pos})
			pos++
		}
	}
	if err := f.db.Omit("OrderCups.Item", "OrderMenus.Menu").Create(&order).Error; err != nil {
		t.Fatal(err)
	}
	return order
}

func (f *caosFixture) createOrder(t *testing.T, no int, lines ...[]models.Item) models.Order {
	t.Helper()
	return f.createOrderAt(t, no, time.Now(), lines...)
}

func (f *caosFixture) cup(t *testing.T, id uuid.UUID) models.OrderCup {
	t.Helper()
	var cup models.OrderCup
	if err := f.db.First(&cup, "id = ?", id).Error; err != nil {
		t.Fatal(err)
	}
	return cup
}

// state は DB の今のカップの値（before に送る）。
func (f *caosFixture) state(t *testing.T, id uuid.UUID) map[string]any {
	t.Helper()
	cup := f.cup(t, id)
	s := caosCupState(&cup)
	return map[string]any{"dripper": s.Dripper, "dripper_position": s.DripperPosition, "drip_id": s.DripId,
		"brew_started_at": s.BrewStartedAt, "brew_finished_at": s.BrewFinishedAt}
}

// unassigned は未割当のカップの今の値（before）、toUnassigned は未割当に戻す書く値（after）
var (
	unassigned   = map[string]any{"dripper": nil, "dripper_position": nil, "drip_id": nil, "brew_started_at": nil, "brew_finished_at": nil}
	toUnassigned = map[string]any{"dripper": nil, "drip_id": nil, "insert_before": nil, "start_brew": false}
)

// placed はドリッパーの最後に置く書く値（after）。start なら抽出を始める（時刻はサーバーが付ける）、でなければ待機
func placed(dripper int, dripID uuid.UUID, start bool) map[string]any {
	return map[string]any{"dripper": dripper, "drip_id": dripID, "insert_before": nil, "start_brew": start}
}

// placedBefore はドリッパーの待機の、before のカードの前に入れる書く値（after）
func placedBefore(dripper int, dripID, before uuid.UUID) map[string]any {
	return map[string]any{"dripper": dripper, "drip_id": dripID, "insert_before": before, "start_brew": false}
}

func write(cups []uuid.UUID, before, after map[string]any) map[string]any {
	return map[string]any{"cup_ids": cups, "before": before, "after": after}
}

// put は PUT /api/caos/cups を呼び、状態コードとエラーを返す。
func (f *caosFixture) put(t *testing.T, writes ...map[string]any) (int, string) {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"writes": writes})
	w := callWithParams(t, f.caos.WriteCaosCups, http.MethodPut, string(body), nil)
	return w.Code, w.Body.String()
}

func (f *caosFixture) mustPut(t *testing.T, writes ...map[string]any) {
	t.Helper()
	if code, body := f.put(t, writes...); code != http.StatusNoContent {
		t.Fatalf("PUT /api/caos/cups = %d: %s", code, body)
	}
}

// wait は CaOS の時計を、抽出を始めてから「次へ」を押せるようになるまで進める。
func (f *caosFixture) wait() { f.skew += caosNextCooldown }

// next は「次へ」を呼ぶ。
func (f *caosFixture) next(t *testing.T, dripper int, seen *uuid.UUID) int {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"drip_id": seen})
	w := callWithParams(t, f.caos.AdvanceCaosDripper, http.MethodPost, string(body), gin.Params{{Key: "dripper", Value: fmt.Sprint(dripper)}})
	return w.Code
}

// finish は「次へ」を start_next: false で呼ぶ（抽出中のカードを終えるだけ）。
func (f *caosFixture) finish(t *testing.T, dripper int, seen *uuid.UUID) int {
	t.Helper()
	body, _ := json.Marshal(map[string]any{"drip_id": seen, "start_next": false})
	w := callWithParams(t, f.caos.AdvanceCaosDripper, http.MethodPost, string(body), gin.Params{{Key: "dripper", Value: fmt.Sprint(dripper)}})
	return w.Code
}

// lane はドリッパーの抽出中と待機のカード（「次へ」と同じ決まりで読み、並べる）。
func (f *caosFixture) lane(t *testing.T, dripper int) (brewing, queued []uuid.UUID) {
	t.Helper()
	start, end := caosToday(time.Now())
	rows, err := readCaosLane(f.db, dripper, start, end)
	if err != nil {
		t.Fatal(err)
	}
	b, q := splitCaosLane(rows)
	for _, card := range b {
		brewing = append(brewing, card.dripID)
	}
	for _, card := range q {
		queued = append(queued, card.dripID)
	}
	return brewing, queued
}

// ハンドラを呼ぶ（パスの引数つき）
func callWithParams(t *testing.T, handler gin.HandlerFunc, method, body string, params gin.Params) *httptest.ResponseRecorder {
	t.Helper()
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(method, "/", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	c.Params = params
	handler(c)
	return w
}

func ids(cups ...models.OrderCup) []uuid.UUID {
	out := make([]uuid.UUID, len(cups))
	for i, c := range cups {
		out[i] = c.ID
	}
	return out
}

func TestCaosWriteCupsOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend, f.blend), line(f.milk))
	o2 := f.createOrder(t, 2, line(f.blend))
	o3 := f.createOrder(t, 3, line(f.blend))
	card1 := uuid.New()
	// サーバーの今。iPad の時計とずれていてもこちらで付ける
	serverNow := time.Now().Add(-37*time.Second - 123456*time.Microsecond)
	f.caos.now = func() time.Time { return serverNow }

	// 割当：2 杯を 1 枚のカードで、空いているドリッパー 1 で始める。開始の時刻はサーバーの今（ミリ秒まで）。
	// after に時刻を送っても使わない（iPad の時計で付けない）
	ipadTime := time.Now().Add(time.Hour)
	after := placed(1, card1, true)
	after["brew_started_at"] = ipadTime
	f.mustPut(t, write(ids(o1.OrderCups[:2]...), unassigned, after))
	for _, c := range o1.OrderCups[:2] {
		cup := f.cup(t, c.ID)
		if cup.Dripper == nil || *cup.Dripper != 1 || cup.DripID == nil || *cup.DripID != card1 || cup.BrewStartedAt == nil {
			t.Fatalf("cup = %+v", cup)
		}
		if !cup.BrewStartedAt.Equal(serverNow.Truncate(time.Millisecond)) || cup.BrewFinishedAt != nil {
			t.Fatalf("brew_started_at = %v, want the server's now %v", cup.BrewStartedAt, serverNow.Truncate(time.Millisecond))
		}
	}
	f.caos.now = time.Now
	// 注文の応答に載る
	var order models.Order
	if err := preloadOrder(db).First(&order, "id = ?", o1.ID).Error; err != nil {
		t.Fatal(err)
	}
	if resp := toOrderResponse(&order); resp.Cups[0].Dripper == nil || resp.Cups[0].DripId == nil || resp.Cups[2].Dripper != nil {
		t.Fatalf("cups in the response = %+v", resp.Cups)
	}

	// 楽観ロック：書く前の値が今と違えば 409（ほかの端末が先に書いた）
	if code, _ := f.put(t, write(ids(o1.OrderCups[:2]...), unassigned, placed(2, card1, false))); code != http.StatusConflict {
		t.Fatalf("stale before = %d, want 409", code)
	}
	// 抽出中のカードの drip_id は変えられない（ほかのカードに統合もしない）。before の時刻はミリ秒までで比べる
	// （画面の Date はミリ秒まで）ので、ミリ秒より細かい違いは 409 でなく、drip_id を変えるから断る 400
	before := f.state(t, o1.OrderCups[0].ID)
	before["brew_started_at"] = f.cup(t, o1.OrderCups[0].ID).BrewStartedAt.Add(500 * time.Microsecond)
	if code, body := f.put(t, write(ids(o1.OrderCups[:2]...), before, placed(2, uuid.New(), false))); code != http.StatusBadRequest ||
		!strings.Contains(body, "drip_id は変えられません") {
		t.Fatalf("change the drip_id of a brewing card = %d: %s, want 400", code, body)
	}
	before["brew_started_at"] = f.cup(t, o1.OrderCups[0].ID).BrewStartedAt.Add(time.Millisecond)
	if code, _ := f.put(t, write(ids(o1.OrderCups[:2]...), before, placed(2, card1, false))); code != http.StatusConflict {
		t.Fatalf("before 1ms off = %d, want 409", code)
	}

	// 抽出が要らないカップはドリッパーにもカードにも入れられない
	if code, _ := f.put(t, write(ids(o1.OrderCups[2]), unassigned, placed(3, uuid.New(), false))); code != http.StatusBadRequest {
		t.Fatalf("milk on a dripper = %d, want 400", code)
	}
	if code, _ := f.put(t, write(ids(o1.OrderCups[2]), unassigned, map[string]any{"dripper": nil, "drip_id": uuid.New(), "insert_before": nil, "start_brew": false})); code != http.StatusBadRequest {
		t.Fatalf("milk in a card = %d, want 400", code)
	}

	f.mustPut(t, write(ids(o2.OrderCups[0]), unassigned, placed(2, uuid.New(), false)))

	// 1 つのドリッパーで抽出中は 1 枚だけ。待機なら置ける
	card3 := uuid.New()
	if code, _ := f.put(t, write(ids(o3.OrderCups[0]), unassigned, placed(1, card3, true))); code != http.StatusBadRequest {
		t.Fatalf("second brewing card = %d, want 400", code)
	}
	f.mustPut(t, write(ids(o3.OrderCups[0]), unassigned, placed(1, card3, false)))

	// 1 枚のカードは 2 杯まで。同じカードのカップは全部いっしょに動かす
	queued2 := f.createOrder(t, 4, line(f.blend, f.blend))
	card4 := uuid.New()
	f.mustPut(t, write(ids(queued2.OrderCups...), unassigned, placed(5, card4, false)))
	if code, _ := f.put(t, write(ids(o3.OrderCups[0]), f.state(t, o3.OrderCups[0].ID), placed(5, card4, false))); code != http.StatusBadRequest {
		t.Fatalf("third cup in a card = %d, want 400", code)
	}
	if code, _ := f.put(t, write(ids(queued2.OrderCups[0]), f.state(t, queued2.OrderCups[0].ID), placed(6, card4, false))); code != http.StatusBadRequest {
		t.Fatalf("a part of a card = %d, want 400", code)
	}

	// まとめた書き込みは、どれか 1 つが通らなければ何も書かない
	if code, _ := f.put(t,
		write(ids(o3.OrderCups[0]), f.state(t, o3.OrderCups[0].ID), unassigned),
		write(ids(o1.OrderCups[2]), unassigned, placed(4, uuid.New(), false)),
	); code != http.StatusBadRequest {
		t.Fatalf("partly invalid writes = %d, want 400", code)
	}
	if cup := f.cup(t, o3.OrderCups[0].ID); cup.Dripper == nil {
		t.Fatal("the valid write of a failed request was saved")
	}

	// 未割当に戻す
	f.mustPut(t, write(ids(o3.OrderCups[0]), f.state(t, o3.OrderCups[0].ID), toUnassigned))
	if cup := f.cup(t, o3.OrderCups[0].ID); cup.Dripper != nil || cup.DripID != nil {
		t.Fatalf("cup = %+v, want unassigned", cup)
	}

	// 注文を編集しても、引き継いだカップは同じ値のまま。新しい明細のカップは未割当
	edit := models.OrderUpdateRequest{OrderId: 1, BillingAmount: 1100, Received: 1100, MenuIds: []models.MenuInfoCreate{
		{MenuId: f.menu.ID, OrderMenuId: &o1.OrderMenus[0].ID}, {MenuId: f.menu.ID, OrderMenuId: &o1.OrderMenus[1].ID},
	}}
	body, _ := json.Marshal(edit)
	if w := callWithParams(t, f.orders.UpdateOrder, http.MethodPut, string(body), gin.Params{{Key: "id", Value: o1.ID.String()}}); w.Code != http.StatusOK {
		t.Fatalf("PUT order = %d: %s", w.Code, w.Body)
	}
	if cup := f.cup(t, o1.OrderCups[1].ID); cup.DripID == nil || *cup.DripID != card1 || cup.BrewStartedAt == nil {
		t.Fatalf("cup after edit = %+v", cup)
	}

	// 前の日の注文のカップは書けない
	old := f.createOrderAt(t, 9, time.Now().Add(-48*time.Hour), line(f.blend))
	if code, _ := f.put(t, write(ids(old.OrderCups[0]), unassigned, placed(5, uuid.New(), false))); code != http.StatusBadRequest {
		t.Fatalf("yesterday's cup = %d, want 400", code)
	}

	// 消えたカップは 409、形の違うリクエストは 400
	if code, _ := f.put(t, write([]uuid.UUID{uuid.New()}, unassigned, placed(5, uuid.New(), false))); code != http.StatusConflict {
		t.Fatalf("missing cup = %d, want 409", code)
	}
	for name, after := range map[string]map[string]any{
		"dripper 7":         placed(7, uuid.New(), false),
		"no drip_id":        {"dripper": 1, "drip_id": nil, "insert_before": nil, "start_brew": false},
		"start unassigned":  {"dripper": nil, "drip_id": uuid.New(), "insert_before": nil, "start_brew": true},
		"before unassigned": {"dripper": nil, "drip_id": uuid.New(), "insert_before": uuid.New(), "start_brew": false},
		"start before":      {"dripper": 1, "drip_id": uuid.New(), "insert_before": uuid.New(), "start_brew": true},
		"before itself":     {"dripper": 1, "drip_id": card1, "insert_before": card1, "start_brew": false},
	} {
		if code, _ := f.put(t, write(ids(o3.OrderCups[0]), unassigned, after)); code != http.StatusBadRequest {
			t.Fatalf("%s = %d, want 400", name, code)
		}
	}
	if code, _ := f.put(t); code != http.StatusBadRequest {
		t.Fatalf("no writes = %d, want 400", code)
	}
}

// nominate は明細の指名（ドリッパーの番号 dripper と自由記述 assignee）を書く
func (f *caosFixture) nominate(t *testing.T, menu models.OrderMenu, dripper *int, assignee *string) {
	t.Helper()
	if err := f.db.Model(&menu).Updates(map[string]any{"dripper": dripper, "assignee": assignee}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestCaosNominationOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o := f.createOrder(t, 1, line(f.blend), line(f.blend), line(f.blend))
	named, legacy := "山田", "3"
	f.nominate(t, o.OrderMenus[0], intPtr(2), &named)
	// 番号より前の明細：自由記述が数字でも指名なし
	f.nominate(t, o.OrderMenus[1], nil, &legacy)

	// 指名の番号（明細の dripper）のあるカップは、その番号のドリッパーにしか置けない
	if code, _ := f.put(t, write(ids(o.OrderCups[0]), unassigned, placed(3, uuid.New(), false))); code != http.StatusBadRequest {
		t.Fatalf("nominated cup on another dripper = %d, want 400", code)
	}
	card := uuid.New()
	f.mustPut(t, write(ids(o.OrderCups[0]), unassigned, placed(2, card, false)))
	// 指名なしのカップ（自由記述だけの古い明細も指名なし）は、指名のカードに入れられる（カードはその番号のドリッパーのまま）
	f.mustPut(t, write(ids(o.OrderCups[1]), unassigned, placed(2, card, false)))
	// 番号の違うカップは 1 枚のカードにできない（未割当のまま統合するときも同じ）
	o2 := f.createOrder(t, 2, line(f.blend))
	f.nominate(t, o2.OrderMenus[0], intPtr(5), nil)
	o3 := f.createOrder(t, 3, line(f.blend))
	f.nominate(t, o3.OrderMenus[0], intPtr(4), nil)
	merge := map[string]any{"dripper": nil, "drip_id": uuid.New(), "insert_before": nil, "start_brew": false}
	if code, _ := f.put(t, write(ids(o2.OrderCups[0], o3.OrderCups[0]), unassigned, merge)); code != http.StatusBadRequest {
		t.Fatalf("merging unassigned cups of different nominations = %d, want 400", code)
	}
	// 指名なしと指名は未割当のままでも統合でき、統合したカードは指名の番号のドリッパーにしか置けない
	merged := uuid.New()
	f.mustPut(t, write(ids(o.OrderCups[2], o2.OrderCups[0]), unassigned, map[string]any{"dripper": nil, "drip_id": merged, "insert_before": nil, "start_brew": false}))
	cups := ids(o.OrderCups[2], o2.OrderCups[0])
	if code, _ := f.put(t, write(cups, f.state(t, cups[0]), placed(1, merged, false))); code != http.StatusBadRequest {
		t.Fatalf("merged nominated card on another dripper = %d, want 400", code)
	}
	f.mustPut(t, write(cups, f.state(t, cups[0]), placed(5, merged, false)))
}

func TestCaosNextOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend, f.blend), line(f.milk))
	o2 := f.createOrder(t, 2, line(f.blend))
	o3 := f.createOrder(t, 3, line(f.blend))
	card1, card2, card3 := uuid.New(), uuid.New(), uuid.New()
	f.mustPut(t,
		write(ids(o1.OrderCups[:2]...), unassigned, placed(1, card1, true)),
		write(ids(o2.OrderCups[0]), unassigned, placed(1, card2, false)),
		// card2 の前に入れる（注文番号より前）
		write(ids(o3.OrderCups[0]), unassigned, placedBefore(1, card3, card2)),
	)

	// 始めてから 10 秒は「次へ」を押せない
	if code := f.next(t, 1, &card1); code != http.StatusBadRequest {
		t.Fatalf("next right after the start = %d, want 400", code)
	}
	f.wait()
	// 次へ：抽出中のカードを終え（終えた時刻だけ。準備完了は付けない）、待機の先頭（順番の小さいもの）を始める
	if code := f.next(t, 1, &card1); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	if got, _ := f.lane(t, 1); len(got) != 1 || got[0] != card3 {
		t.Fatalf("brewing after next = %v, want %v", got, card3)
	}
	for _, c := range o1.OrderCups {
		if cup := f.cup(t, c.ID); cup.ReadyAt != nil {
			t.Fatalf("cup = %+v, want not ready (ready_at is for the serve screen)", cup)
		}
	}
	for _, c := range o1.OrderCups[:2] {
		if cup := f.cup(t, c.ID); cup.BrewFinishedAt == nil {
			t.Fatalf("cup = %+v, want finished", cup)
		}
	}
	var order models.Order
	if err := db.First(&order, "id = ?", o1.ID).Error; err != nil || order.ReadyAt != nil {
		t.Fatalf("order = %+v, want not ready", order)
	}
	if cup := f.cup(t, o3.OrderCups[0].ID); cup.BrewStartedAt == nil {
		t.Fatal("the next card did not start")
	}

	// 同じカードの「次へ」をもう一度押しても、次のカードは終わらせない。抽出中があるのに無いと見ていても断る
	if code := f.next(t, 1, &card1); code != http.StatusConflict {
		t.Fatalf("second next = %d, want 409", code)
	}
	if code := f.next(t, 1, nil); code != http.StatusConflict {
		t.Fatalf("next without the brewing card = %d, want 409", code)
	}

	// 提供の画面でカップを準備完了・提供済みにしても、CaOS の盤面（抽出の時刻）は書かず、抽出中のカードは抽出中のまま。
	// 終えるのは CaOS の「次へ」だけ
	cupParams := gin.Params{{Key: "id", Value: o3.ID.String()}, {Key: "cupId", Value: o3.OrderCups[0].ID.String()}}
	for _, mark := range []gin.HandlerFunc{f.orders.MarkOrderCupReady, f.orders.MarkOrderCupServed} {
		if w := callWithParams(t, mark, http.MethodPatch, "", cupParams); w.Code != http.StatusOK {
			t.Fatalf("PATCH cup ready/served = %d", w.Code)
		}
		if cup := f.cup(t, o3.OrderCups[0].ID); cup.BrewStartedAt == nil || cup.BrewFinishedAt != nil {
			t.Fatalf("cup made ready/served = %+v, want the brew times unchanged", cup)
		}
		if brewing, queued := f.lane(t, 1); !slices.Equal(brewing, []uuid.UUID{card3}) || !slices.Equal(queued, []uuid.UUID{card2}) {
			t.Fatalf("lane after the cup got ready/served = %v %v, want %v brewing and %v queued", brewing, queued, card3, card2)
		}
	}
	if code := f.next(t, 1, nil); code != http.StatusConflict {
		t.Fatalf("next without the served brewing card = %d, want 409", code)
	}
	f.wait()
	if code := f.next(t, 1, &card3); code != http.StatusNoContent {
		t.Fatalf("next of the served card = %d", code)
	}
	if got, _ := f.lane(t, 1); !slices.Equal(got, []uuid.UUID{card2}) {
		t.Fatalf("brewing after next = %v, want %v", got, card2)
	}
	f.wait()
	if code := f.next(t, 1, &card2); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	o4 := f.createOrder(t, 4, line(f.blend))
	card4 := uuid.New()
	if code, body := f.put(t, write(ids(o4.OrderCups[0]), unassigned, placed(1, card4, true))); code != http.StatusNoContent {
		t.Fatalf("brewing after the master = %d: %s", code, body)
	}
	f.wait()
	if code := f.next(t, 1, &card4); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	// 何も無いドリッパー・形の違う番号
	if code := f.next(t, 1, nil); code != http.StatusConflict {
		t.Fatalf("next on an empty dripper = %d, want 409", code)
	}
	if code := f.next(t, 7, nil); code != http.StatusBadRequest {
		t.Fatalf("next on dripper 7 = %d, want 400", code)
	}

	// 前の日の注文のカップは見ない（終わっていない抽出中が残っていても、今日の盤面は空）
	start := time.Now().Add(-time.Minute)
	old := f.createOrderAt(t, 9, time.Now().Add(-48*time.Hour), line(f.blend))
	dripper, pos, id := 2, 1, uuid.New()
	if err := db.Model(&models.OrderCup{}).Where("id = ?", old.OrderCups[0].ID).
		Updates(caosUpdates(models.CaosCupAfter{Dripper: &dripper, DripId: &id}, &pos, &start)).Error; err != nil {
		t.Fatal(err)
	}
	if code := f.next(t, 2, nil); code != http.StatusConflict {
		t.Fatalf("next with yesterday's card = %d, want 409", code)
	}
	f.mustPut(t, write(ids(o1.OrderCups[2]), unassigned, toUnassigned)) // 何も変えない書き込みも通る
}

// TestCaosFinishOnlyOnDB は start_next: false（抽出中のカードを押して終えるだけ）を確かめる。待機の先頭は始めず、
// 始めてから 10 秒の決まりは「次へ」と同じ。抽出中が無ければ断る。省略すれば今まで通り待機の先頭を始める（TestCaosNextOnDB）
func TestCaosFinishOnlyOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend))
	o2 := f.createOrder(t, 2, line(f.blend))
	card1, card2 := uuid.New(), uuid.New()
	f.mustPut(t,
		write(ids(o1.OrderCups[0]), unassigned, placed(1, card1, true)),
		write(ids(o2.OrderCups[0]), unassigned, placed(1, card2, false)),
	)

	if code := f.finish(t, 1, &card1); code != http.StatusBadRequest {
		t.Fatalf("finish right after the start = %d, want 400", code)
	}
	f.wait()
	if code := f.finish(t, 1, &card1); code != http.StatusNoContent {
		t.Fatalf("finish = %d", code)
	}
	if cup := f.cup(t, o1.OrderCups[0].ID); cup.BrewFinishedAt == nil || cup.ReadyAt != nil {
		t.Fatalf("finished cup = %+v, want finished and not ready", cup)
	}
	if cup := f.cup(t, o2.OrderCups[0].ID); cup.BrewStartedAt != nil {
		t.Fatalf("queued cup = %+v, want not started", cup)
	}
	if brewing, queued := f.lane(t, 1); len(brewing) != 0 || !slices.Equal(queued, []uuid.UUID{card2}) {
		t.Fatalf("lane after finish = %v %v, want none brewing and %v queued", brewing, queued, card2)
	}
	// 抽出中が無ければ終えるものが無い（待機の先頭も始めない）
	if code := f.finish(t, 1, nil); code != http.StatusConflict {
		t.Fatalf("finish without a brewing card = %d, want 409", code)
	}
	if cup := f.cup(t, o2.OrderCups[0].ID); cup.BrewStartedAt != nil {
		t.Fatalf("queued cup = %+v, want not started", cup)
	}
	// start_drip_id は、待機の先頭がそのカードのときだけ始める（違えば何も変えずに 409）
	startWith := func(id uuid.UUID) int {
		body, _ := json.Marshal(map[string]any{"drip_id": nil, "start_drip_id": id})
		return callWithParams(t, f.caos.AdvanceCaosDripper, http.MethodPost, string(body), gin.Params{{Key: "dripper", Value: "1"}}).Code
	}
	if code := startWith(card1); code != http.StatusConflict {
		t.Fatalf("start another card = %d, want 409", code)
	}
	if cup := f.cup(t, o2.OrderCups[0].ID); cup.BrewStartedAt != nil {
		t.Fatalf("queued cup = %+v, want not started", cup)
	}
	if code := startWith(card2); code != http.StatusNoContent {
		t.Fatalf("start the head = %d", code)
	}
	if got, _ := f.lane(t, 1); !slices.Equal(got, []uuid.UUID{card2}) {
		t.Fatalf("brewing = %v, want %v", got, card2)
	}
}

// 抽出を始められるのは、空いている（そのカードのほかに抽出中・待機のカードが無い）ドリッパーに置くときだけ。
// 待機があるときに始めるのは「次へ」（待機の先頭）。画面の assignWrites も空いているドリッパーへの割当だけ start_brew を送る
// TestCaosStartBrewOnDB は start_brew（列の先頭に入れて今から始める）を確かめる。抽出中が無く待機のある列では待機の先頭を飛ばさず、
// 抽出中のある列では同じ書き込みで抽出中を待機に下げたときだけ始められる。
func TestCaosStartBrewOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	var o []models.Order
	for no := 1; no <= 4; no++ {
		o = append(o, f.createOrder(t, no, line(f.blend)))
	}
	cupOf := func(i int) uuid.UUID { return o[i].OrderCups[0].ID }
	a, b, c, d := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	expectLane := func(dripper int, wantBrewing []uuid.UUID, wantQueued ...uuid.UUID) {
		t.Helper()
		if brewing, queued := f.lane(t, dripper); !slices.Equal(brewing, wantBrewing) || !slices.Equal(queued, wantQueued) {
			t.Fatalf("dripper %d = %v / %v, want %v / %v", dripper, brewing, queued, wantBrewing, wantQueued)
		}
	}

	// 抽出中が無く待機のあるドリッパーでは、待機の先頭を飛ばして始められない（始めるのは「次へ」）。待機がそのカードだけなら始められる
	f.mustPut(t, write(ids(o[0].OrderCups[0]), unassigned, placed(1, a, false)))
	if code, body := f.put(t, write(ids(o[1].OrderCups[0]), unassigned, placed(1, b, true))); code != http.StatusBadRequest ||
		!strings.Contains(body, "待機のカードがある") {
		t.Fatalf("start skipping the queue = %d: %s, want 400", code, body)
	}
	f.mustPut(t, write(ids(o[0].OrderCups[0]), f.state(t, cupOf(0)), placed(1, a, true)))
	f.mustPut(t, write(ids(o[1].OrderCups[0]), unassigned, placed(1, b, false)))
	expectLane(1, []uuid.UUID{a}, b)
	// 抽出中があれば、それを待機に下げずに始めることはできない（400。何も書かない）
	if code, body := f.put(t, write(ids(o[2].OrderCups[0]), unassigned, placed(1, c, true))); code != http.StatusBadRequest ||
		!strings.Contains(body, "もう抽出中") {
		t.Fatalf("second brewing card = %d: %s, want 400", code, body)
	}
	if cup := f.cup(t, cupOf(2)); cup.Dripper != nil {
		t.Fatalf("cup = %+v, want unassigned", cup)
	}
	// 同じ書き込みで抽出中を待機の先頭に下げれば始められる。書き込みの順によらない（抽出中の枚数を確かめるのは全部書いたあと）
	f.mustPut(t,
		write(ids(o[2].OrderCups[0]), unassigned, placed(1, c, true)),
		write(ids(o[0].OrderCups[0]), f.state(t, cupOf(0)), placedBefore(1, a, b)),
	)
	expectLane(1, []uuid.UUID{c}, a, b)
	if cup := f.cup(t, cupOf(0)); cup.BrewStartedAt != nil {
		t.Fatalf("demoted card = %+v, want no start", cup)
	}
	// 空いているドリッパーへ置いてそのまま始める
	f.mustPut(t, write(ids(o[3].OrderCups[0]), unassigned, placed(2, d, true)))
	expectLane(2, []uuid.UUID{d})
}

// TestCaosMoveBrewingOnDB は抽出中のカードを動かす（先頭は抽出中。先頭に入れたら今から始め、先頭でない所なら始めた時刻を消す）。
func TestCaosMoveBrewingOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	var o []models.Order
	for no := 1; no <= 5; no++ {
		o = append(o, f.createOrder(t, no, line(f.blend)))
	}
	cupOf := func(i int) uuid.UUID { return o[i].OrderCups[0].ID }
	x, a, b, y, c := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	expectLane := func(dripper int, wantBrewing []uuid.UUID, wantQueued ...uuid.UUID) {
		t.Helper()
		if brewing, queued := f.lane(t, dripper); !slices.Equal(brewing, wantBrewing) || !slices.Equal(queued, wantQueued) {
			t.Fatalf("dripper %d = %v / %v, want %v / %v", dripper, brewing, queued, wantBrewing, wantQueued)
		}
	}
	startedAt := func(i int) time.Time {
		t.Helper()
		cup := f.cup(t, cupOf(i))
		if cup.BrewStartedAt == nil {
			t.Fatalf("cup %d has no start", i)
		}
		return *cup.BrewStartedAt
	}
	// 1 番：x 抽出中、a・b 待機。2 番：y 抽出中、c 待機
	f.mustPut(t, write(ids(o[0].OrderCups[0]), unassigned, placed(1, x, true)))
	f.mustPut(t, write(ids(o[1].OrderCups[0]), unassigned, placed(1, a, false)))
	f.mustPut(t, write(ids(o[2].OrderCups[0]), unassigned, placed(1, b, false)))
	f.mustPut(t, write(ids(o[3].OrderCups[0]), unassigned, placed(2, y, true)))
	f.mustPut(t, write(ids(o[4].OrderCups[0]), unassigned, placed(2, c, false)))
	xStart := startedAt(0)

	// 同じ列の b の前へ下げる：x は始めた時刻を消して待機、先頭になった a を今から始める
	f.wait()
	f.mustPut(t,
		write(ids(o[0].OrderCups[0]), f.state(t, cupOf(0)), placedBefore(1, x, b)),
		write(ids(o[1].OrderCups[0]), f.state(t, cupOf(1)), placed(1, a, true)),
	)
	expectLane(1, []uuid.UUID{a}, x, b)
	if aStart := startedAt(1); !aStart.After(xStart) {
		t.Fatalf("a started at %v, want after %v", aStart, xStart)
	}
	if cup := f.cup(t, cupOf(0)); cup.BrewStartedAt != nil || cup.BrewFinishedAt != nil {
		t.Fatalf("x = %+v, want queued", cup)
	}

	// 1 番の抽出中 a を 2 番の先頭へ：a は今から始め直し、y は待機の先頭へ。1 番の列は始めない
	f.wait()
	aStart := startedAt(1)
	f.mustPut(t,
		write(ids(o[3].OrderCups[0]), f.state(t, cupOf(3)), placedBefore(2, y, c)),
		write(ids(o[1].OrderCups[0]), f.state(t, cupOf(1)), placed(2, a, true)),
	)
	expectLane(2, []uuid.UUID{a}, y, c)
	expectLane(1, nil, x, b)
	if restarted := startedAt(1); !restarted.After(aStart) {
		t.Fatalf("a restarted at %v, want after %v", restarted, aStart)
	}

	// 抽出中を別の列の待機へ：始めた時刻を消して待機
	f.mustPut(t, write(ids(o[1].OrderCups[0]), f.state(t, cupOf(1)), placed(1, a, false)))
	expectLane(1, nil, x, b, a)
	expectLane(2, nil, y, c)

	// 抽出中を未割当に戻す：ドリッパー・順番・始めた時刻を消す
	f.mustPut(t, write(ids(o[0].OrderCups[0]), f.state(t, cupOf(0)), placed(3, x, true)))
	f.mustPut(t, write(ids(o[0].OrderCups[0]), f.state(t, cupOf(0)), toUnassigned))
	if cup := f.cup(t, cupOf(0)); cup.Dripper != nil || cup.DripperPosition != nil || cup.DripID != nil || cup.BrewStartedAt != nil {
		t.Fatalf("unassigned = %+v", cup)
	}
	expectLane(3, nil)

	// 終わったカード（「次へ」で終えた）は動かせない。抽出中のカードは、カップが全部準備完了でも動かせる。1 番は b を始めて終え、a を始める
	if code := f.next(t, 1, nil); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	f.wait()
	if code := f.next(t, 1, &b); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	if code, body := f.put(t, write(ids(o[2].OrderCups[0]), f.state(t, cupOf(2)), placed(4, b, false))); code != http.StatusBadRequest ||
		!strings.Contains(body, "終わったカード") {
		t.Fatalf("move a finished card = %d: %s", code, body)
	}
	now := time.Now()
	if err := db.Model(&models.OrderCup{}).Where("id = ?", cupOf(1)).Updates(map[string]any{"ready_at": now, "served_at": now}).Error; err != nil {
		t.Fatal(err)
	}
	f.mustPut(t, write(ids(o[1].OrderCups[0]), f.state(t, cupOf(1)), placed(4, a, false)))
	expectLane(4, nil, a)
}

func TestCaosConcurrentWrites(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	var orders []models.Order
	for no := 1; no <= 6; no++ {
		orders = append(orders, f.createOrder(t, no, line(f.blend)))
	}
	// 6 台が同時に、別のカードを空いているドリッパー 2 で始めようとする：通るのは 1 枚だけ（ほかは 400）
	var wg sync.WaitGroup
	codes := make([]int, len(orders))
	for i, o := range orders {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i], _ = f.put(t, write(ids(o.OrderCups[0]), unassigned, placed(2, uuid.New(), true)))
		}()
	}
	wg.Wait()
	ok := 0
	for _, code := range codes {
		switch code {
		case http.StatusNoContent:
			ok++
		case http.StatusBadRequest:
		default:
			t.Fatalf("PUT = %d", code)
		}
	}
	if ok != 1 {
		t.Fatalf("%d brewing cards were written, want 1", ok)
	}
	var brewingID uuid.UUID
	var rest []models.Order
	for i, o := range orders {
		if codes[i] == http.StatusNoContent {
			brewingID = *f.cup(t, o.OrderCups[0].ID).DripID
		} else {
			rest = append(rest, o)
		}
	}

	// 5 台が同時に同じカップを別のドリッパーへ：同じ before で送るので、通るのは 1 台だけ（ほかは 409）
	target := rest[0].OrderCups[0].ID
	codes = make([]int, 5)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i], _ = f.put(t, write([]uuid.UUID{target}, unassigned, placed(3+i%3, uuid.New(), false)))
		}()
	}
	wg.Wait()
	ok = 0
	for _, code := range codes {
		switch code {
		case http.StatusNoContent:
			ok++
		case http.StatusConflict:
		default:
			t.Fatalf("PUT = %d", code)
		}
	}
	if ok != 1 {
		t.Fatalf("%d writes of the same cup succeeded, want 1", ok)
	}

	// 残りを待機に入れ、5 台が同時に同じカードの「次へ」：通るのは 1 回だけ
	for _, o := range rest[1:] {
		f.mustPut(t, write(ids(o.OrderCups[0]), unassigned, placed(2, uuid.New(), false)))
	}
	f.wait()
	codes = make([]int, 5)
	for i := range codes {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i] = f.next(t, 2, &brewingID)
		}()
	}
	wg.Wait()
	ok = 0
	for _, code := range codes {
		switch code {
		case http.StatusNoContent:
			ok++
		case http.StatusConflict:
		default:
			t.Fatalf("next = %d", code)
		}
	}
	if ok != 1 {
		t.Fatalf("%d nexts succeeded, want 1", ok)
	}
	if got, _ := f.lane(t, 2); len(got) != 1 {
		t.Fatalf("brewing on dripper 2 = %v, want 1 card", got)
	}

	// 注文の編集と CaOS の割当・戻すが重なっても、どちらの変更も消えない
	o := f.createOrder(t, 7, line(f.blend), line(f.blend))
	edit := models.OrderUpdateRequest{OrderId: 7, BillingAmount: 1000, Received: 1000, MenuIds: []models.MenuInfoCreate{
		{MenuId: f.menu.ID, OrderMenuId: &o.OrderMenus[0].ID}, {MenuId: f.menu.ID, OrderMenuId: &o.OrderMenus[1].ID},
	}}
	body, _ := json.Marshal(edit)
	card := uuid.New()
	wg.Add(2)
	go func() {
		defer wg.Done()
		for range 15 {
			if w := callWithParams(t, f.orders.UpdateOrder, http.MethodPut, string(body), gin.Params{{Key: "id", Value: o.ID.String()}}); w.Code != http.StatusOK {
				t.Errorf("PUT order = %d", w.Code)
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := range 15 {
			after := toUnassigned
			if i%2 == 0 {
				after = placed(4, card, false)
			}
			if code, body := f.put(t, write(ids(o.OrderCups...), f.state(t, o.OrderCups[0].ID), after)); code != http.StatusNoContent {
				t.Errorf("PUT caos %d = %d: %s", i, code, body)
			}
		}
	}()
	wg.Wait()
	// 最後は割当（i = 14）
	for _, c := range o.OrderCups {
		if cup := f.cup(t, c.ID); cup.DripID == nil || *cup.DripID != card || cup.Dripper == nil || *cup.Dripper != 4 {
			t.Fatalf("cup %+v lost the last write", cup)
		}
	}
}

// broadcastOrders は hub に溜まった注文の配信を、しばらく届かなくなるまで読み、注文の ID を返す。
func broadcastOrders(t *testing.T, h *Hub) map[uuid.UUID]bool {
	t.Helper()
	got := map[uuid.UUID]bool{}
	for {
		select {
		case msg := <-h.broadcast:
			if msg.Type == WSMessageTypeOrder && msg.Order != nil {
				got[uuid.UUID(msg.Order.Id)] = true
			}
		case <-time.After(300 * time.Millisecond):
			return got
		}
	}
}

// position はカップの今の番号。
func (f *caosFixture) position(t *testing.T, id uuid.UUID) int {
	t.Helper()
	cup := f.cup(t, id)
	if cup.DripperPosition == nil {
		t.Fatalf("cup %s has no dripper_position", id)
	}
	return *cup.DripperPosition
}

func TestCaosWritePublishesOrders(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o := f.createOrder(t, 1, line(f.blend))
	hub := NewHub()
	f.caos.hub = hub

	// 書いた注文を、このインスタンスにつないでいる画面へ配る（カップに CaOS の列が載る）
	card := uuid.New()
	f.mustPut(t, write(ids(o.OrderCups[0]), unassigned, placed(3, card, false)))
	msg := nextBroadcast(t, hub)
	if msg.Type != WSMessageTypeOrder || msg.Order == nil || msg.Order.Cups[0].DripId == nil || uuid.UUID(*msg.Order.Cups[0].DripId) != card {
		t.Fatalf("broadcast = %+v", msg)
	}
	if p := msg.Order.Cups[0].DripperPosition; p == nil || *p != 1 {
		t.Fatalf("dripper_position in the broadcast = %v, want 1", p)
	}

	// 「次へ」も同じ
	if code := f.next(t, 3, nil); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	msg = nextBroadcast(t, hub)
	if msg.Order == nil || msg.Order.Cups[0].BrewStartedAt == nil {
		t.Fatalf("broadcast = %+v", msg)
	}

	// 途中に入れたら、番号をずらしたカップの注文も配る（ずらさなかった注文は配らない）
	o2 := f.createOrder(t, 2, line(f.blend))
	o3 := f.createOrder(t, 3, line(f.blend))
	o4 := f.createOrder(t, 4, line(f.blend))
	c2, c3 := uuid.New(), uuid.New()
	f.mustPut(t,
		write(ids(o2.OrderCups[0]), unassigned, placed(3, c2, false)),
		write(ids(o3.OrderCups[0]), unassigned, placed(3, c3, false)),
	)
	broadcastOrders(t, hub)
	f.mustPut(t, write(ids(o4.OrderCups[0]), unassigned, placedBefore(3, uuid.New(), c3)))
	if got := broadcastOrders(t, hub); len(got) != 2 || !got[o4.ID] || !got[o3.ID] {
		t.Fatalf("broadcast orders = %v, want %s and %s", got, o4.ID, o3.ID)
	}
}

func TestCaosInsertOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	var o []models.Order
	for no := 1; no <= 7; no++ {
		o = append(o, f.createOrder(t, no, line(f.blend)))
	}
	a, b, c, d, e := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	cupOf := func(i int) uuid.UUID { return o[i].OrderCups[0].ID }
	expect := func(want map[int]int) {
		t.Helper()
		for i, p := range want {
			if got := f.position(t, cupOf(i)); got != p {
				t.Errorf("position of order %d = %d, want %d", i+1, got, p)
			}
		}
	}
	expectQueue := func(dripper int, want ...uuid.UUID) {
		t.Helper()
		if _, got := f.lane(t, dripper); !slices.Equal(got, want) {
			t.Fatalf("queue of dripper %d = %v, want %v", dripper, got, want)
		}
	}

	// 空いているドリッパーに置いて始める：1。最後に置く：終わっていないカップの最大＋1
	f.mustPut(t, write(ids(o[0].OrderCups[0]), unassigned, placed(1, a, true)))
	f.mustPut(t, write(ids(o[1].OrderCups[0]), unassigned, placed(1, b, false)))
	f.mustPut(t, write(ids(o[2].OrderCups[0]), unassigned, placed(1, c, false)))
	expect(map[int]int{0: 1, 1: 2, 2: 3})
	expectQueue(1, b, c)

	// 途中に入れる（c の前）：d が c の番号になり、c から後ろが +1。前（a・b）は動かない
	f.mustPut(t, write(ids(o[3].OrderCups[0]), unassigned, placedBefore(1, d, c)))
	expect(map[int]int{0: 1, 1: 2, 2: 4, 3: 3})
	expectQueue(1, b, d, c)

	// 先頭に割り込む（待機の先頭 b の前）：抽出中の a（番号 1）は動かない
	f.mustPut(t, write(ids(o[4].OrderCups[0]), unassigned, placedBefore(1, e, b)))
	expect(map[int]int{0: 1, 1: 3, 2: 5, 3: 4, 4: 2})
	expectQueue(1, e, b, d, c)

	// 同じドリッパーの中で動かす：c を先頭（e の前）へ。c の元の番号（5）は空いたまま
	f.mustPut(t, write(ids(o[2].OrderCups[0]), f.state(t, cupOf(2)), placedBefore(1, c, e)))
	expect(map[int]int{0: 1, 1: 4, 2: 2, 3: 5, 4: 3})
	expectQueue(1, c, e, b, d)

	// 最後へ（before が null）：自分を除いた最大＋1
	f.mustPut(t, write(ids(o[4].OrderCups[0]), f.state(t, cupOf(4)), placed(1, e, false)))
	expect(map[int]int{2: 2, 1: 4, 3: 5, 4: 6})
	expectQueue(1, c, b, d, e)

	// 別のドリッパーへ移す：抜けた番号は詰めない
	f.mustPut(t, write(ids(o[1].OrderCups[0]), f.state(t, cupOf(1)), placed(2, b, false)))
	expect(map[int]int{1: 1, 2: 2, 3: 5, 4: 6})
	expectQueue(1, c, d, e)
	expectQueue(2, b)

	// 楽観ロック：ずらしたカップを、ずらす前の値で動かそうとしたら 409
	stale := f.state(t, cupOf(4))
	f.mustPut(t, write(ids(o[5].OrderCups[0]), unassigned, placedBefore(1, uuid.New(), e)))
	if code, _ := f.put(t, write(ids(o[4].OrderCups[0]), stale, placed(3, e, false))); code != http.StatusConflict {
		t.Fatalf("move with the position before the shift = %d, want 409", code)
	}

	// 前に入れるカードが、そのドリッパーの待機に無ければ 409（ほかのドリッパー・抽出中・無いカード）
	for name, before := range map[string]uuid.UUID{"on another dripper": b, "brewing": a, "missing": uuid.New()} {
		if code, _ := f.put(t, write(ids(o[6].OrderCups[0]), unassigned, placedBefore(1, uuid.New(), before))); code != http.StatusConflict {
			t.Fatalf("before a card %s = %d, want 409", name, code)
		}
	}

	// 前の日の終わっていないカップは、最大にも数えず、ずらさない
	old := f.createOrderAt(t, 9, time.Now().Add(-48*time.Hour), line(f.blend))
	dripper, oldPos, oldID := 4, 50, uuid.New()
	if err := db.Model(&models.OrderCup{}).Where("id = ?", old.OrderCups[0].ID).
		Updates(caosUpdates(models.CaosCupAfter{Dripper: &dripper, DripId: &oldID}, &oldPos, nil)).Error; err != nil {
		t.Fatal(err)
	}
	f.mustPut(t, write(ids(o[6].OrderCups[0]), unassigned, placed(4, uuid.New(), false)))
	if got := f.position(t, cupOf(6)); got != 1 {
		t.Fatalf("position next to yesterday's cup = %d, want 1", got)
	}
}

func TestCaosMergeQueuedOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend))
	o2 := f.createOrder(t, 2, line(f.blend))
	o3 := f.createOrder(t, 3, line(f.blend))
	c1, c2, c3 := uuid.New(), uuid.New(), uuid.New()
	f.mustPut(t,
		write(ids(o1.OrderCups[0]), unassigned, placed(5, c1, false)),
		write(ids(o2.OrderCups[0]), unassigned, placed(5, c2, false)),
		write(ids(o3.OrderCups[0]), unassigned, placed(6, c3, false)),
	)

	// 待機どうしの統合：c3 のカップが c1 のカードに入る（番号は c1 と同じ。ずらさない）。c1 も同じ値で書いて確かめる
	join := map[string]any{"dripper": 5, "drip_id": c1, "insert_before": nil, "start_brew": false}
	f.mustPut(t,
		write(ids(o3.OrderCups[0]), f.state(t, o3.OrderCups[0].ID), join),
		write(ids(o1.OrderCups[0]), f.state(t, o1.OrderCups[0].ID), join),
	)
	if p1, p3, p2 := f.position(t, o1.OrderCups[0].ID), f.position(t, o3.OrderCups[0].ID), f.position(t, o2.OrderCups[0].ID); p1 != 1 || p3 != 1 || p2 != 2 {
		t.Fatalf("positions after merge = %d, %d, %d, want 1, 1, 2", p1, p3, p2)
	}
	if _, got := f.lane(t, 5); !slices.Equal(got, []uuid.UUID{c1, c2}) {
		t.Fatalf("queue = %v", got)
	}
	// ほかのカードに入るときに前のカードは決められない
	o4 := f.createOrder(t, 4, line(f.blend))
	if code, _ := f.put(t, write(ids(o4.OrderCups[0]), unassigned, map[string]any{"dripper": 5, "drip_id": c2, "insert_before": c1, "start_brew": false})); code != http.StatusBadRequest {
		t.Fatalf("join with before = %d, want 400", code)
	}
}

// 抽出を始めたカードにも 1 杯を足せる（開始の時刻はそのカードのまま）。終わったカードには入れず、抽出中のカードのカップは動かせない
func TestCaosMergeIntoBrewingOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend))
	o2 := f.createOrder(t, 2, line(f.blend))
	o3 := f.createOrder(t, 3, line(f.blend))
	card := uuid.New()
	f.mustPut(t, write(ids(o1.OrderCups[0]), unassigned, placed(3, card, true)))
	started := f.cup(t, o1.OrderCups[0].ID).BrewStartedAt
	f.wait()
	f.mustPut(t, write(ids(o2.OrderCups[0]), unassigned, placed(3, card, false)))
	if got := f.cup(t, o2.OrderCups[0].ID); !timeEqual(got.BrewStartedAt, started) || *got.DripperPosition != *f.cup(t, o1.OrderCups[0].ID).DripperPosition {
		t.Fatalf("joined cup = %+v, want the card's start %v", got, started)
	}
	// 抽出中のカードのカップは外せない（3 杯目も入らない）
	if code, _ := f.put(t, write(ids(o2.OrderCups[0]), f.state(t, o2.OrderCups[0].ID), toUnassigned)); code != http.StatusBadRequest {
		t.Fatalf("moving a cup out of the brewing card = %d, want 400", code)
	}
	if code, _ := f.put(t, write(ids(o3.OrderCups[0]), unassigned, placed(3, card, false))); code != http.StatusBadRequest {
		t.Fatalf("third cup = %d, want 400", code)
	}
	if code := f.next(t, 3, &card); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	if got := f.cup(t, o2.OrderCups[0].ID); got.ReadyAt != nil || got.BrewFinishedAt == nil {
		t.Fatalf("joined cup after next = %+v, want finished and not ready", got)
	}
	// 終わったカードには入れない
	if code, _ := f.put(t, write(ids(o3.OrderCups[0]), unassigned, placed(3, card, false))); code != http.StatusBadRequest {
		t.Fatalf("joining a finished card = %d, want 400", code)
	}
}

// 提供の画面で提供済み・準備完了にしても（取り消しても）、CaOS の盤面（抽出の時刻）は書かない。「次へ」は CaOS で押す
func TestCaosServeKeepsBoardOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	o1 := f.createOrder(t, 1, line(f.blend))
	o2 := f.createOrder(t, 2, line(f.blend))
	o3 := f.createOrder(t, 3, line(f.blend), line(f.blend))
	merged, next := uuid.New(), uuid.New()
	f.mustPut(t,
		write(ids(o1.OrderCups[0]), unassigned, placed(4, merged, true)),
		write(ids(o2.OrderCups[0]), unassigned, placed(4, merged, false)),
		write(ids(o3.OrderCups[0]), unassigned, placed(4, next, false)),
	)
	states := func() []models.CaosCupState {
		var out []models.CaosCupState
		for _, o := range []models.Order{o1, o2, o3} {
			cup := f.cup(t, o.OrderCups[0].ID)
			out = append(out, caosCupState(&cup))
		}
		return out
	}
	before := states()
	for _, call := range []struct {
		name    string
		handler gin.HandlerFunc
		params  gin.Params
	}{
		{"cup served (queued card)", f.orders.MarkOrderCupServed, gin.Params{{Key: "id", Value: o3.ID.String()}, {Key: "cupId", Value: o3.OrderCups[1].ID.String()}}},
		{"cup ready (brewing card)", f.orders.MarkOrderCupReady, gin.Params{{Key: "id", Value: o2.ID.String()}, {Key: "cupId", Value: o2.OrderCups[0].ID.String()}}},
		{"order served", f.orders.MarkOrderServed, gin.Params{{Key: "id", Value: o1.ID.String()}}},
		{"order served (undo)", f.orders.MarkOrderServed, gin.Params{{Key: "id", Value: o1.ID.String()}}},
		{"order ready", f.orders.MarkOrderReady, gin.Params{{Key: "id", Value: o1.ID.String()}}},
	} {
		if w := callWithParams(t, call.handler, http.MethodPatch, "", call.params); w.Code != http.StatusOK {
			t.Fatalf("%s = %d", call.name, w.Code)
		}
		if got := states(); !reflect.DeepEqual(got, before) {
			t.Fatalf("after %s the board = %+v, want %+v", call.name, got, before)
		}
	}
	// 統合したカードは全部のカップが準備完了・提供済みでも抽出中のまま（終えるのは CaOS の「次へ」だけ）
	if brewing, queued := f.lane(t, 4); !slices.Equal(brewing, []uuid.UUID{merged}) || !slices.Equal(queued, []uuid.UUID{next}) {
		t.Fatalf("lane = %v %v, want %v brewing and %v queued", brewing, queued, merged, next)
	}
	f.wait()
	if code := f.next(t, 4, &merged); code != http.StatusNoContent {
		t.Fatalf("next = %d", code)
	}
	if brewing, queued := f.lane(t, 4); !slices.Equal(brewing, []uuid.UUID{next}) || len(queued) != 0 {
		t.Fatalf("lane after next = %v %v, want %v brewing", brewing, queued, next)
	}
}

// 待機を丸ごと別のドリッパーへ（画面の moveQueueWrites）：1 回の PUT で、並びのまま最後に入れ、空いていれば先頭を始める
func TestCaosMoveQueueOnDB(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	var cards []uuid.UUID
	var orders []models.Order
	for no := 1; no <= 3; no++ {
		o := f.createOrder(t, no, line(f.blend))
		orders = append(orders, o)
		cards = append(cards, uuid.New())
		f.mustPut(t, write(ids(o.OrderCups[0]), unassigned, placed(1, cards[no-1], no == 1)))
	}
	move := func(i int, start bool) map[string]any {
		return write(ids(orders[i].OrderCups[0]), f.state(t, orders[i].OrderCups[0].ID), placed(6, cards[i], start))
	}
	f.mustPut(t, move(1, true), move(2, false))
	brewing, queued := f.lane(t, 6)
	if !slices.Equal(brewing, cards[1:2]) || !slices.Equal(queued, cards[2:]) {
		t.Fatalf("dripper 6 = %v %v, want %v %v", brewing, queued, cards[1:2], cards[2:])
	}
	if _, queued := f.lane(t, 1); len(queued) != 0 {
		t.Fatalf("dripper 1 queue = %v, want empty", queued)
	}
}

func TestCaosConcurrentInserts(t *testing.T) {
	db := openCaosTestDB(t)
	f := newCaosFixture(t, db)
	head := f.createOrder(t, 1, line(f.blend), line(f.blend))
	headCard := uuid.New()
	f.mustPut(t, write(ids(head.OrderCups[0]), unassigned, placed(4, headCard, false)))
	const n = 8
	var orders []models.Order
	for i := range n {
		orders = append(orders, f.createOrder(t, 10+i, line(f.blend)))
	}

	// n 台が同時に、待機の先頭（head）の前に入れ、同じ時に head の注文を編集する：
	// 全部通り、番号はぶつからず、head は n だけずれる（注文の編集で淹れ直したカップも、ずらした番号を失わない）
	edit := models.OrderUpdateRequest{OrderId: 1, BillingAmount: 1000, Received: 1000, MenuIds: []models.MenuInfoCreate{
		{MenuId: f.menu.ID, OrderMenuId: &head.OrderMenus[0].ID}, {MenuId: f.menu.ID, OrderMenuId: &head.OrderMenus[1].ID},
	}}
	body, _ := json.Marshal(edit)
	var wg sync.WaitGroup
	codes := make([]int, n)
	for i, o := range orders {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i], _ = f.put(t, write(ids(o.OrderCups[0]), unassigned, placedBefore(4, uuid.New(), headCard)))
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		for range 10 {
			if w := callWithParams(t, f.orders.UpdateOrder, http.MethodPut, string(body), gin.Params{{Key: "id", Value: head.ID.String()}}); w.Code != http.StatusOK {
				t.Errorf("PUT order = %d", w.Code)
			}
		}
	}()
	wg.Wait()
	for i, code := range codes {
		if code != http.StatusNoContent {
			t.Fatalf("insert %d = %d", i, code)
		}
	}
	var headCups []models.OrderCup
	if err := db.Find(&headCups, "drip_id = ?", headCard).Error; err != nil || len(headCups) != 1 {
		t.Fatalf("head cups = %+v (%v)", headCups, err)
	}
	if p := headCups[0].DripperPosition; p == nil || *p != n+1 {
		t.Fatalf("head position = %v, want %d", p, n+1)
	}
	seen := map[int]bool{}
	for _, o := range orders {
		p := f.position(t, o.OrderCups[0].ID)
		if seen[p] || p < 1 || p > n {
			t.Fatalf("position %d is duplicated or out of 1..%d", p, n)
		}
		seen[p] = true
	}
	if _, q := f.lane(t, 4); len(q) != n+1 || q[n] != headCard {
		t.Fatalf("queue = %v, want head at the end", q)
	}

	// n 台が同時に最後へ置く：番号は 1..n でぶつからない
	var more []models.Order
	for i := range n {
		more = append(more, f.createOrder(t, 30+i, line(f.blend)))
	}
	for i, o := range more {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codes[i], _ = f.put(t, write(ids(o.OrderCups[0]), unassigned, placed(5, uuid.New(), false)))
		}()
	}
	wg.Wait()
	seen = map[int]bool{}
	for i, o := range more {
		if codes[i] != http.StatusNoContent {
			t.Fatalf("append %d = %d", i, codes[i])
		}
		p := f.position(t, o.OrderCups[0].ID)
		if seen[p] || p < 1 || p > n {
			t.Fatalf("appended position %d is duplicated or out of 1..%d", p, n)
		}
		seen[p] = true
	}
}

// ドリッパーの列の決まり（抽出中・待機の並び・終わり）が、画面の caosLane と同じ入力で同じ結果になるか。
// 例は modules/common/src/lib/caos-lane-cases.json（画面のテスト caos-board.test.ts も同じ例を読む）。
func TestSplitCaosLaneCases(t *testing.T) {
	data, err := os.ReadFile("../../../modules/common/src/lib/caos-lane-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Cases []struct {
			Name string
			Cups []struct {
				DripID          uuid.UUID `json:"drip_id"`
				OrderNo         int       `json:"order_no"`
				DripperPosition int       `json:"dripper_position"`
				Started         bool
				Finished        bool
				Ready           bool
				Served          bool
			}
			Brewing *uuid.UUID
			Queued  []uuid.UUID
		}
	}
	if err := json.Unmarshal(data, &file); err != nil {
		t.Fatal(err)
	}
	if len(file.Cases) == 0 {
		t.Fatal("no cases")
	}
	at := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	timeIf := func(ok bool) *time.Time {
		if !ok {
			return nil
		}
		return &at
	}
	for _, tc := range file.Cases {
		t.Run(tc.Name, func(t *testing.T) {
			var rows []caosUnit
			for _, c := range tc.Cups {
				dripper, pos, id := 1, c.DripperPosition, c.DripID
				rows = append(rows, caosUnit{OrderNo: c.OrderNo, OrderCup: models.OrderCup{
					ID: uuid.New(), Dripper: &dripper, DripperPosition: &pos, DripID: &id,
					BrewStartedAt: timeIf(c.Started), BrewFinishedAt: timeIf(c.Finished),
					ReadyAt: timeIf(c.Ready || c.Served), ServedAt: timeIf(c.Served),
				}})
			}
			brewing, queued := splitCaosLane(rows)
			var gotBrewing *uuid.UUID
			if len(brewing) > 1 {
				t.Fatalf("%d brewing cards", len(brewing))
			} else if len(brewing) == 1 {
				gotBrewing = &brewing[0].dripID
			}
			if !ptrEqual(gotBrewing, tc.Brewing) {
				t.Errorf("brewing = %v, want %v", gotBrewing, tc.Brewing)
			}
			gotQueued := make([]uuid.UUID, len(queued))
			for i, card := range queued {
				gotQueued[i] = card.dripID
			}
			if !slices.Equal(gotQueued, tc.Queued) && (len(gotQueued) > 0 || len(tc.Queued) > 0) {
				t.Errorf("queued = %v, want %v", gotQueued, tc.Queued)
			}
		})
	}
}
