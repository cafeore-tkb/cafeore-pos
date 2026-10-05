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
	if err := db.Exec("TRUNCATE caos_drips, caos_boards, order_menus, comments, orders, menu_items, menus, items, item_types").Error; err != nil {
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
		_, err := s.OrdersChanged(tx, []OrderRef{{ID: o.ID, CreatedAt: o.CreatedAt}})
		return err
	}))
	return o
}

func load(t *testing.T, s *Store) *Snapshot {
	t.Helper()
	snap, _, err := s.Load(testDay)
	must(t, err)
	return snap
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
	s := NewStore(db)

	// 注文：優勝・優勝＋トート・アイスミルク → 優勝 2 杯のカード 1 枚
	o1 := createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ, cat.champTote, cat.milk)
	snap := load(t, s)
	if len(snap.Drips) != 1 || snap.Drips[0].Cups != 2 || snap.Version != 1 {
		t.Fatalf("注文を作ると同じトランザクションでカードができる：%+v", snap)
	}
	card := snap.Drips[0]

	assigned, err := s.Apply(testDay, Op{Name: "assign", DripID: card.ID, Dripper: ptr(1)})
	must(t, err)
	if assigned.Version != 2 || assigned.Changed[0].Status != StatusBrewing {
		t.Fatalf("割当：%+v", assigned)
	}
	before := viaJSON(t, assigned.Changed)

	done, err := s.Apply(testDay, Op{Name: "next", Dripper: ptr(1)})
	must(t, err)
	if !slices.Equal(done.Readied, []string{o1.ID.String()}) || readyAt(t, db, o1.ID) == nil {
		t.Fatalf("次へで注文のカードが全部終わると、同じトランザクションで ready_at が付く：%+v", done)
	}

	// 1つ戻す（画面が JSON で受け取った結果をそのまま返す）
	undo, err := s.Apply(testDay, Op{Name: "restore", Before: before, After: viaJSON(t, done.Changed), Readied: done.Readied})
	must(t, err)
	if undo.Changed[0].Status != StatusBrewing || readyAt(t, db, o1.ID) != nil {
		t.Fatalf("1つ戻すで抽出中に戻り、ready_at が外れる：%+v", undo)
	}
	if _, err := s.Apply(testDay, Op{Name: "restore", Before: before, After: viaJSON(t, done.Changed)}); !IsInvalid(err) {
		t.Fatalf("2 回目は断る：%v", err)
	}

	// ルールに合わない操作は、版も進めずに断る
	v := load(t, s).Version
	if _, err := s.Apply(testDay, Op{Name: "next", Dripper: ptr(6)}); !IsInvalid(err) {
		t.Fatalf("invalid のはず：%v", err)
	}
	if load(t, s).Version != v {
		t.Fatal("断った操作で版が進んだ")
	}
}

func TestStorePosReadyAndDelete(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := NewStore(db)
	o1 := createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	o2 := createOrder(t, s, db, 2, dayStart.Add(10*time.Hour+time.Minute), cat.champ)
	snap := load(t, s)
	_, err := s.Apply(testDay, Op{Name: "merge", FirstID: snap.Drips[0].ID, SecondID: snap.Drips[1].ID})
	must(t, err)

	// POS で #1 を準備完了 → 統合カードが終わり、#2 も準備完了になる
	must(t, db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&o1).Update("ready_at", time.Now()).Error; err != nil {
			return err
		}
		_, err := s.OrdersChanged(tx, []OrderRef{{ID: o1.ID, CreatedAt: o1.CreatedAt}})
		return err
	}))
	if readyAt(t, db, o2.ID) == nil || load(t, s).Drips[0].Status != StatusDone {
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
		_, err := s.OrdersChanged(tx, []OrderRef{{ID: o3.ID, CreatedAt: o3.CreatedAt}})
		return err
	}))
	for _, d := range load(t, s).Drips {
		if slices.Contains(d.OrderIDs, o3.ID.String()) {
			t.Fatal("消した注文のカードが残っている")
		}
	}
}

func TestStoreLoadCatchesUpAndSeparatesDays(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := NewStore(db)
	// 盤面に知らせずに入った注文（この機能より前の注文など）と、前の日・次の日の注文
	for i, at := range []time.Time{dayStart.Add(9 * time.Hour), dayStart.Add(-time.Minute), dayStart.AddDate(0, 0, 1)} {
		o := models.Order{ID: uuid.New(), OrderId: i + 1, CreatedAt: at, OrderMenus: []models.OrderMenu{{ID: uuid.New(), MenuID: cat.champ, MenuName: "x"}}}
		must(t, db.Create(&o).Error)
	}
	snap := load(t, s)
	if len(snap.Drips) != 1 || snap.Drips[0].Lines[0].OrderNo != 1 {
		t.Fatalf("読むときにその日の注文だけと照らし合わせて追いつく：%+v", snap.Drips)
	}
	if again := load(t, s); again.Version != snap.Version {
		t.Fatal("変わらなければ版を進めない")
	}
}

func TestStoreSerializesConcurrentOps(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := NewStore(db)
	for i := range 10 {
		createOrder(t, s, db, i+1, dayStart.Add(10*time.Hour+time.Duration(i)*time.Minute), cat.champ)
	}
	snap := load(t, s)
	var wg sync.WaitGroup
	errs := make(chan error, len(snap.Drips))
	for _, d := range snap.Drips {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, err := s.Apply(testDay, Op{Name: "assign", DripID: d.ID, Dripper: ptr(1)})
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		must(t, err)
	}
	after := load(t, s)
	brewing := 0
	for _, d := range after.Drips {
		if d.Status == StatusBrewing {
			brewing++
		}
	}
	if brewing != 1 || after.Version != snap.Version+int64(len(snap.Drips)) {
		t.Fatalf("同時に割り当てても 1 件ずつ処理され、抽出中は 1 枚・版は件数分進む：brewing=%d v=%d→%d", brewing, snap.Version, after.Version)
	}
}

func TestStoreNotifiesOtherInstances(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := NewStore(db)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := pgx.Connect(ctx, os.Getenv("CAOS_TEST_DATABASE_URL"))
	must(t, err)
	defer func() { _ = conn.Close(context.Background()) }()
	_, err = conn.Exec(ctx, "LISTEN "+ChangedChannel)
	must(t, err)

	createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	n, err := conn.WaitForNotification(ctx)
	must(t, err)
	if n.Payload != testDay+":1" {
		t.Fatalf("日付と版を知らせる：%q", n.Payload)
	}
}

// 変わるものがなければ、読むときに盤面のロックを取らない（画面のつなぎ直しで、注文の受付や操作を待たせない）
func TestStoreLoadDoesNotLockWhenUnchanged(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := NewStore(db)
	createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	want := load(t, s)

	holder := db.Begin()
	must(t, holder.Exec("SELECT * FROM caos_boards WHERE day = ? FOR UPDATE", testDay).Error)
	defer holder.Rollback()
	done := make(chan *Snapshot, 1)
	go func() {
		snap, _, err := s.Load(testDay)
		if err != nil {
			t.Error(err)
		}
		done <- snap
	}()
	select {
	case snap := <-done:
		if snap.Version != want.Version || len(snap.Drips) != len(want.Drips) {
			t.Fatalf("同じ盤面が読める：%+v", snap)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("ロックを待ってしまった")
	}
}
