package caos

import (
	"context"
	"encoding/json"
	"os"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/models"
)

// 本物の Postgres で盤面の保存を確かめる。CAOS_TEST_DATABASE_URL を渡したときだけ動く（空の DB を渡すこと。表を作り直す）。
//
//	CAOS_TEST_DATABASE_URL=postgres://postgres@localhost:55432/caos_test go test ./internal/caos/

func testDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("CAOS_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("CAOS_TEST_DATABASE_URL がないので、DB を使うテストは飛ばす")
	}
	// 本番と同じく、プリペアドステートメントを使わない設定でつなぐ
	db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{Logger: logger.Discard, PrepareStmt: false})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.ItemType{}, &models.Item{}, &models.Menu{}, &models.MenuItem{}, &models.Order{}, &models.Comment{}, &models.OrderMenu{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(mustRead(t, "../../sql/2026-10_caos.sql")).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("TRUNCATE caos_drips, order_menus, comments, orders, menu_items, menus, items, item_types").Error; err != nil {
		t.Fatal(err)
	}
	return db
}

func mustRead(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return string(b)
}

type catalog struct{ champ, champTote, milk uuid.UUID }

// 優勝（1 杯）・優勝＋トートのセット・アイスミルクのメニュー
func seedCatalog(t *testing.T, db *gorm.DB) catalog {
	t.Helper()
	hot := models.ItemType{Name: "hot", DisplayName: "ホット"}
	others := models.ItemType{Name: "others", DisplayName: "その他"}
	milkType := models.ItemType{Name: "milk", DisplayName: "ミルク"}
	for _, it := range []*models.ItemType{&hot, &others, &milkType} {
		must(t, db.Create(it).Error)
	}
	champItem := models.Item{Name: "優勝ブレンド", Abbr: "優勝", ItemTypeID: hot.ID}
	toteItem := models.Item{Name: "トート", Abbr: "トート", ItemTypeID: others.ID}
	milkItem := models.Item{Name: "アイスミルク", Abbr: "ミルク", ItemTypeID: milkType.ID}
	for _, it := range []*models.Item{&champItem, &toteItem, &milkItem} {
		must(t, db.Create(it).Error)
	}
	menu := func(key string, items ...models.Item) uuid.UUID {
		m := models.Menu{Name: key, Abbr: key, Price: 500, Key: key}
		must(t, db.Create(&m).Error)
		for _, it := range items {
			must(t, db.Create(&models.MenuItem{MenuID: m.ID, ItemID: it.ID, Quantity: 1}).Error)
		}
		return m.ID
	}
	return catalog{champ: menu("champ", champItem), champTote: menu("tote-set", champItem, toteItem), milk: menu("milk", milkItem)}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

const testDay = "2026-11-01"

var dayStart = time.Date(2026, 11, 1, 0, 0, 0, 0, jst)

// POS と同じく注文を作り、同じトランザクションで盤面に知らせる
func createOrder(t *testing.T, s *Store, db *gorm.DB, no int, at time.Time, menus ...uuid.UUID) models.Order {
	t.Helper()
	o := models.Order{ID: uuid.New(), OrderId: no, CreatedAt: at, BillingAmount: 500, Received: 500}
	for _, m := range menus {
		o.OrderMenus = append(o.OrderMenus, models.OrderMenu{ID: uuid.New(), OrderID: o.ID, MenuID: m, MenuName: "x", UnitPrice: 500})
	}
	must(t, db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&o).Error; err != nil {
			return err
		}
		return s.OrdersChanged(tx, []OrderRef{{ID: o.ID, CreatedAt: o.CreatedAt}})
	}))
	return o
}

func drips(t *testing.T, s *Store) []Drip {
	t.Helper()
	d, err := s.Drips(testDay)
	must(t, err)
	return d
}

func newStore(db *gorm.DB) *Store {
	s := NewStore(db)
	s.today = func() string { return testDay }
	return s
}

func readyAt(t *testing.T, db *gorm.DB, id uuid.UUID) *time.Time {
	t.Helper()
	var o models.Order
	must(t, db.First(&o, "id = ?", id).Error)
	return o.ReadyAt
}

// 画面と同じく JSON で受け取ったカードにする（時刻の精度が往復で変わらないことも確かめる）
func viaJSON(t *testing.T, drips []Drip) []Drip {
	t.Helper()
	b, err := json.Marshal(drips)
	must(t, err)
	var out []Drip
	must(t, json.Unmarshal(b, &out))
	return out
}

func TestStoreFlow(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)

	// 注文：優勝・優勝＋トート・アイスミルク → 優勝 2 杯のカード 1 枚（明細は注文と商品の参照だけ）
	o1 := createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ, cat.champTote, cat.milk)
	d := drips(t, s)
	if len(d) != 1 || d[0].Cups != 2 || d[0].Lines[0].OrderID != o1.ID.String() {
		t.Fatalf("注文を作ると同じトランザクションでカードができる：%+v", d)
	}

	assigned, err := s.Apply(Op{Name: "assign", DripID: d[0].ID, Dripper: ptr(1)})
	must(t, err)
	if assigned.Changed[0].Status != StatusBrewing {
		t.Fatalf("割当：%+v", assigned)
	}
	before := viaJSON(t, assigned.Changed)

	done, err := s.Apply(Op{Name: "next", Dripper: ptr(1)})
	must(t, err)
	if !slices.Equal(done.Completed, []string{o1.ID.String()}) {
		t.Fatalf("次へで注文のカードが全部終わったと返す：%+v", done)
	}
	if readyAt(t, db, o1.ID) != nil {
		t.Fatal("準備完了は盤面では付けない（画面が既存の API で付ける）")
	}

	// 1つ戻す（画面が JSON で受け取った結果をそのまま返す）
	undo, err := s.Apply(Op{Name: "restore", Before: before, After: viaJSON(t, done.Changed)})
	must(t, err)
	if undo.Changed[0].Status != StatusBrewing {
		t.Fatalf("1つ戻すで抽出中に戻る：%+v", undo)
	}
	if _, err := s.Apply(Op{Name: "restore", Before: before, After: viaJSON(t, done.Changed)}); !IsInvalid(err) {
		t.Fatalf("2 回目は断る：%v", err)
	}
	if _, err := s.Apply(Op{Name: "next", Dripper: ptr(6)}); !IsInvalid(err) {
		t.Fatalf("invalid のはず：%v", err)
	}
}

func TestStorePosReadyAndDelete(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	o1 := createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	o2 := createOrder(t, s, db, 2, dayStart.Add(10*time.Hour+time.Minute), cat.champ)
	d := drips(t, s)
	_, err := s.Apply(Op{Name: "merge", FirstID: d[0].ID, SecondID: d[1].ID})
	must(t, err)

	// POS で #1 を準備完了 → 統合カードが終わり、#2 も同じ tx で準備完了になる
	must(t, db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&o1).Update("ready_at", time.Now()).Error; err != nil {
			return err
		}
		return s.OrdersChanged(tx, []OrderRef{{ID: o1.ID, CreatedAt: o1.CreatedAt}})
	}))
	if readyAt(t, db, o2.ID) == nil || drips(t, s)[0].Status != StatusDone {
		t.Fatal("POS の準備完了で統合相手も準備完了になる")
	}

	// 注文の削除：未割当のカードが片付く
	o3 := createOrder(t, s, db, 3, dayStart.Add(11*time.Hour), cat.champ)
	must(t, db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Where("order_id = ?", o3.ID).Delete(&models.OrderMenu{}).Error; err != nil {
			return err
		}
		if err := tx.Delete(&models.Order{}, "id = ?", o3.ID).Error; err != nil {
			return err
		}
		return s.OrdersChanged(tx, []OrderRef{{ID: o3.ID, CreatedAt: o3.CreatedAt}})
	}))
	for _, d := range drips(t, s) {
		if slices.Contains(d.OrderIDs, o3.ID.String()) {
			t.Fatal("消した注文のカードが残っている")
		}
	}
}

func TestStoreApplyCatchesUpAndSeparatesDays(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	synced := createOrder(t, s, db, 1, dayStart.Add(9*time.Hour), cat.champ)
	// 盤面に知らせずに入った注文（連動が失敗した・この機能より前の注文など）と、前の日・次の日の注文
	for i, at := range []time.Time{dayStart.Add(9*time.Hour + time.Minute), dayStart.Add(-time.Minute), dayStart.AddDate(0, 0, 1)} {
		o := models.Order{ID: uuid.New(), OrderId: i + 2, CreatedAt: at, OrderMenus: []models.OrderMenu{{ID: uuid.New(), MenuID: cat.champ, MenuName: "x"}}}
		must(t, db.Create(&o).Error)
	}
	if len(drips(t, s)) != 1 {
		t.Fatal("知らせずに入った注文のカードは、まだない")
	}
	_, err := s.Apply(Op{Name: "assign", DripID: drips(t, s)[0].ID, Dripper: ptr(1)})
	must(t, err)
	var orders []string
	for _, d := range drips(t, s) {
		orders = append(orders, d.OrderIDs...)
	}
	if len(orders) != 2 || orders[0] != synced.ID.String() {
		t.Fatalf("操作のときに、その日の注文だけと照らし合わせて追いつく：%v", orders)
	}
}

func TestStoreSerializesConcurrentOps(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	for i := range 10 {
		createOrder(t, s, db, i+1, dayStart.Add(10*time.Hour+time.Duration(i)*time.Minute), cat.champ)
	}
	var wg sync.WaitGroup
	errs := make(chan error, 10)
	for _, d := range drips(t, s) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Apply(Op{Name: "assign", DripID: d.ID, Dripper: ptr(1)})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		must(t, err)
	}
	brewing, queued := 0, 0
	for _, d := range drips(t, s) {
		switch d.Status {
		case StatusBrewing:
			brewing++
		case StatusQueued:
			queued++
		}
	}
	if brewing != 1 || queued != 9 {
		t.Fatalf("同時に割り当てても 1 件ずつ処理され、抽出中は 1 枚：brewing=%d queued=%d", brewing, queued)
	}
}

// caos_drips が変わると、トリガー（api/sql/2026-10_caos.sql）が通知を送る。各インスタンスはこれを受けて DB から読み直して配る
func TestStoreTriggerNotifies(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, os.Getenv("CAOS_TEST_DATABASE_URL"))
	must(t, err)
	defer func() { _ = conn.Close(context.Background()) }()
	_, err = conn.Exec(ctx, "LISTEN "+ChangedChannel)
	must(t, err)

	createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	if _, err := conn.WaitForNotification(ctx); err != nil {
		t.Fatalf("カードができたら通知が届く：%v", err)
	}
}
