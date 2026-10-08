package handlers

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"cafeore-pos/api/internal/caos"
	"cafeore-pos/api/internal/models"
)

// 本物の Postgres で CaOS の盤面の保存（CaosStore）を確かめる。CAOS_TEST_DATABASE_URL を渡したときだけ動く（空の DB を渡すこと。表を作り直す）。
//
//	CAOS_TEST_DATABASE_URL=postgres://postgres@localhost:55432/caos_test go test ./internal/handlers/

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
	// CaOS の表は毎回作り直す（スキーマは Go のモデルだけで決まることを確かめるため）
	if err := db.Exec("DROP TABLE IF EXISTS caos_drips, caos_lanes, caos_ops, caos_practices, print_jobs").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&models.ItemType{}, &models.Item{}, &models.Menu{}, &models.MenuItem{}, &models.Order{}, &models.Comment{}, &models.OrderMenu{}, &models.OrderCup{},
		&models.CaosDripRow{}, &models.CaosLaneRow{}, &models.CaosOpRow{}, &models.CaosPracticeRow{}, &models.PrintJobRow{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("TRUNCATE caos_drips, caos_lanes, caos_ops, caos_practices, print_jobs, order_cups, order_menus, comments, orders, menu_items, menus, items, item_types").Error; err != nil {
		t.Fatal(err)
	}
	return db
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

func ptr[T any](v T) *T { return &v }

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

const testDay = "2026-11-01"

var dayStart = time.Date(2026, 11, 1, 0, 0, 0, 0, time.FixedZone("JST", 9*60*60))

// POS と同じく注文を作り、同じトランザクションで盤面に知らせる
func createOrder(t *testing.T, s *CaosStore, db *gorm.DB, no int, at time.Time, menus ...uuid.UUID) models.Order {
	t.Helper()
	o := models.Order{ID: uuid.New(), OrderId: no, CreatedAt: at, BillingAmount: 500, Received: 500}
	for _, m := range menus {
		o.OrderMenus = append(o.OrderMenus, models.OrderMenu{ID: uuid.New(), OrderID: o.ID, MenuID: m, MenuName: "x", UnitPrice: 500})
	}
	must(t, db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&o).Error; err != nil {
			return err
		}
		_, err := s.OrdersChanged(tx, []caosOrderRef{{ID: o.ID, CreatedAt: o.CreatedAt}})
		return err
	}))
	return o
}

func drips(t *testing.T, s *CaosStore) []caos.Drip {
	t.Helper()
	d, err := s.Drips(testDay)
	must(t, err)
	return d
}

func newStore(db *gorm.DB) *CaosStore {
	s := NewCaosStore(db)
	s.today = func() string { return testDay }
	return s
}

func readyAt(t *testing.T, db *gorm.DB, id uuid.UUID) *time.Time {
	t.Helper()
	var o models.Order
	must(t, db.First(&o, "id = ?", id).Error)
	return o.ReadyAt
}

func TestCaosStoreFlow(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)

	// 注文：優勝・優勝＋トート・アイスミルク → 優勝 2 杯のカード 1 枚（明細は注文と商品の参照だけ）
	o1 := createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ, cat.champTote, cat.milk)
	d := drips(t, s)
	if len(d) != 1 || d[0].Cups != 2 || d[0].Lines[0].OrderID != o1.ID.String() {
		t.Fatalf("注文を作ると同じトランザクションでカードができる：%+v", d)
	}

	assigned, err := s.Apply(caos.Op{Name: "assign", DripID: d[0].ID, Dripper: ptr(1)})
	must(t, err)
	if assigned.Changed[0].Status != caos.StatusBrewing || assigned.OpID == "" {
		t.Fatalf("割当：%+v", assigned)
	}

	done, err := s.Apply(caos.Op{Name: "next", Dripper: ptr(1)})
	must(t, err)
	if !slices.Equal(done.Readied, []string{o1.ID.String()}) || readyAt(t, db, o1.ID) == nil {
		t.Fatalf("次へで注文のカードが全部終わると、同じトランザクションで準備完了になる：%+v", done)
	}

	// 1つ戻す：操作の ID だけを送る（カードの中身は、サーバーが残した記録で戻す）
	undo, err := s.Apply(caos.Op{Name: "undo", OpID: done.OpID})
	must(t, err)
	if undo.Changed[0].Status != caos.StatusBrewing || readyAt(t, db, o1.ID) != nil || !slices.Equal(undo.Readied, []string{o1.ID.String()}) {
		t.Fatalf("1つ戻すで、カードも準備完了もそろって戻る：%+v", undo)
	}
	if _, err := s.Apply(caos.Op{Name: "undo", OpID: done.OpID}); !caos.IsInvalid(err) {
		t.Fatalf("同じ操作は 2 回戻せない：%v", err)
	}
	// 割当も戻せる（抽出中 → 未割当）
	if _, err := s.Apply(caos.Op{Name: "undo", OpID: assigned.OpID}); err != nil || drips(t, s)[0].Status != caos.StatusUnassigned {
		t.Fatalf("割当を戻す：%v %+v", err, drips(t, s))
	}
	for _, bad := range []string{"", "nope", uuid.NewString()} {
		if _, err := s.Apply(caos.Op{Name: "undo", OpID: bad}); !caos.IsInvalid(err) {
			t.Fatalf("知らない操作は戻せない（%q）：%v", bad, err)
		}
	}
	if _, err := s.Apply(caos.Op{Name: "next", Dripper: ptr(6)}); !caos.IsInvalid(err) {
		t.Fatalf("invalid のはず：%v", err)
	}
}

// 状態をまとめて読む（戻すのを断ったときに、何も変わっていないことを比べる）
func boardState(t *testing.T, db *gorm.DB, s *CaosStore, orderID uuid.UUID) string {
	t.Helper()
	var undone int64
	must(t, db.Model(&models.CaosOpRow{}).Where("undone_at IS NOT NULL").Count(&undone).Error)
	b, err := json.Marshal([]any{drips(t, s), readyAt(t, db, orderID), undone})
	must(t, err)
	return string(b)
}

// 記録のあと関係するカードや注文が触られていたら、戻すのを断り、何も変えない
func TestCaosStoreUndoRejectsWhenTouched(t *testing.T) {
	cases := map[string]func(t *testing.T, db *gorm.DB, s *CaosStore, o models.Order){
		"カードが後から触られた": func(t *testing.T, db *gorm.DB, s *CaosStore, o models.Order) {
			// 別の注文のカードを同じドリッパーに積むと、終わったカードは変わらないが…次の抽出が始まる。ここでは直接カードを書き換える
			must(t, db.Exec("UPDATE caos_drips SET updated_at = now()").Error)
		},
		"注文が提供済みになった": func(t *testing.T, db *gorm.DB, s *CaosStore, o models.Order) {
			must(t, db.Exec("UPDATE orders SET served_at = now() WHERE id = ?", o.ID).Error)
		},
		"準備完了が付け直された": func(t *testing.T, db *gorm.DB, s *CaosStore, o models.Order) {
			must(t, db.Exec("UPDATE orders SET ready_at = now() + interval '1 second' WHERE id = ?", o.ID).Error)
		},
	}
	for name, touch := range cases {
		t.Run(name, func(t *testing.T) {
			db := testDB(t)
			cat := seedCatalog(t, db)
			s := newStore(db)
			o := createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
			_, err := s.Apply(caos.Op{Name: "assign", DripID: drips(t, s)[0].ID, Dripper: ptr(1)})
			must(t, err)
			done, err := s.Apply(caos.Op{Name: "next", Dripper: ptr(1)})
			must(t, err)
			touch(t, db, s, o)
			before := boardState(t, db, s, o.ID)
			if _, err := s.Apply(caos.Op{Name: "undo", OpID: done.OpID}); !caos.IsInvalid(err) {
				t.Fatalf("断るはず：%v", err)
			}
			if after := boardState(t, db, s, o.ID); after != before {
				t.Fatalf("断ったのに変わった：\n%s\n%s", before, after)
			}
		})
	}
}

// レビューで指摘された順番：A の次へ → 同じドリッパーで B が始まる → A の次へを戻す。
// 抽出中が重なるので、内部エラー（索引違反）ではなく ErrInvalid で断り、カードも準備完了も記録も何も変えない
func TestCaosStoreUndoRejectsBrewingConflict(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	o1 := createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	createOrder(t, s, db, 2, dayStart.Add(10*time.Hour+time.Minute), cat.champ)
	d := drips(t, s)
	_, err := s.Apply(caos.Op{Name: "assign", DripID: d[0].ID, Dripper: ptr(1)})
	must(t, err)
	done, err := s.Apply(caos.Op{Name: "next", Dripper: ptr(1)})
	must(t, err)
	_, err = s.Apply(caos.Op{Name: "assign", DripID: d[1].ID, Dripper: ptr(1)})
	must(t, err)

	before := boardState(t, db, s, o1.ID)
	if _, err := s.Apply(caos.Op{Name: "undo", OpID: done.OpID}); !caos.IsInvalid(err) {
		t.Fatalf("422 で断るはず（500 にしない）：%v", err)
	}
	if after := boardState(t, db, s, o1.ID); after != before {
		t.Fatalf("断ったのに変わった：\n%s\n%s", before, after)
	}
}

// 統合で消えたカード・入れ直しで増えたカードも、サーバーの記録だけで戻る（画面からは何も送らない）
func TestCaosStoreUndoMergeAndRebrewFromRecord(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	createOrder(t, s, db, 2, dayStart.Add(10*time.Hour+time.Minute), cat.champ)
	orig := drips(t, s)

	merged, err := s.Apply(caos.Op{Name: "merge", FirstID: orig[0].ID, SecondID: orig[1].ID})
	must(t, err)
	_, err = s.Apply(caos.Op{Name: "undo", OpID: merged.OpID})
	must(t, err)
	if got := drips(t, s); len(got) != 2 || got[0].Cups != 1 || got[1].ID != orig[1].ID || got[1].Lines[0] != orig[1].Lines[0] {
		t.Fatalf("統合を戻すと、消えたカードが元の中身で戻る：%+v", got)
	}

	_, err = s.Apply(caos.Op{Name: "assign", DripID: orig[0].ID, Dripper: ptr(1)})
	must(t, err)
	rebrew, err := s.Apply(caos.Op{Name: "rebrew", SourceID: orig[0].ID, Cups: 1, Interrupt: true, Dripper: ptr(2)})
	must(t, err)
	if len(drips(t, s)) != 3 {
		t.Fatal("入れ直しのカードができる")
	}
	_, err = s.Apply(caos.Op{Name: "undo", OpID: rebrew.OpID})
	must(t, err)
	got := drips(t, s)
	if len(got) != 2 || got[0].Status != caos.StatusBrewing || got[0].Interrupted {
		t.Fatalf("入れ直しを戻すと、できたカードが消え、途中でやめた抽出が抽出中に戻る：%+v", got)
	}
}

// 戻す途中で失敗したら（ここでは注文のロック待ちの打ち切り）、カードも準備完了も操作の記録も、何も変わらない
func TestCaosStoreUndoIsAllOrNothing(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	o := createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	_, err := s.Apply(caos.Op{Name: "assign", DripID: drips(t, s)[0].ID, Dripper: ptr(1)})
	must(t, err)
	done, err := s.Apply(caos.Op{Name: "next", Dripper: ptr(1)})
	must(t, err)

	// 接続文字列にもともとクエリ（?sslmode=... など）があれば & でつなぐ
	dsn := os.Getenv("CAOS_TEST_DATABASE_URL")
	sep := "?"
	if strings.Contains(dsn, "?") {
		sep = "&"
	}
	short, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn + sep + "options=-c%20lock_timeout%3D300ms", PreferSimpleProtocol: true}), &gorm.Config{Logger: logger.Discard})
	must(t, err)
	timeoutStore := newStore(short)
	holder := db.Begin()
	must(t, holder.Exec("SELECT * FROM orders WHERE id = ? FOR UPDATE", o.ID).Error)
	before := boardState(t, db, s, o.ID)
	_, err = timeoutStore.Apply(caos.Op{Name: "undo", OpID: done.OpID})
	must(t, holder.Rollback().Error)
	if err == nil || caos.IsInvalid(err) {
		t.Fatalf("ロック待ちの打ち切りで失敗するはず：%v", err)
	}
	if after := boardState(t, db, s, o.ID); after != before {
		t.Fatalf("途中で失敗したのに変わった：\n%s\n%s", before, after)
	}
	// 失敗のあとでも、もう一度戻せる
	if _, err := s.Apply(caos.Op{Name: "undo", OpID: done.OpID}); err != nil || readyAt(t, db, o.ID) != nil {
		t.Fatalf("やり直せば戻る：%v", err)
	}
}

func TestCaosStorePosReadyAndDelete(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	o1 := createOrder(t, s, db, 1, dayStart.Add(10*time.Hour), cat.champ)
	o2 := createOrder(t, s, db, 2, dayStart.Add(10*time.Hour+time.Minute), cat.champ)
	d := drips(t, s)
	_, err := s.Apply(caos.Op{Name: "merge", FirstID: d[0].ID, SecondID: d[1].ID})
	must(t, err)

	// POS で #1 を準備完了 → 統合カードが終わり、#2 も同じ tx で準備完了になる（ハンドラーが配れるよう #2 を返す）
	var readied []uuid.UUID
	must(t, db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&o1).Update("ready_at", time.Now()).Error; err != nil {
			return err
		}
		var err error
		readied, err = s.OrdersChanged(tx, []caosOrderRef{{ID: o1.ID, CreatedAt: o1.CreatedAt}})
		return err
	}))
	if readyAt(t, db, o2.ID) == nil || drips(t, s)[0].Status != caos.StatusDone {
		t.Fatal("POS の準備完了で統合相手も準備完了になる")
	}
	if len(readied) != 1 || readied[0] != o2.ID {
		t.Fatalf("準備完了にした統合相手を返す：%v", readied)
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
		_, err := s.OrdersChanged(tx, []caosOrderRef{{ID: o3.ID, CreatedAt: o3.CreatedAt}})
		return err
	}))
	for _, d := range drips(t, s) {
		if slices.Contains(d.OrderIDs, o3.ID.String()) {
			t.Fatal("消した注文のカードが残っている")
		}
	}
}

func TestCaosStoreApplyCatchesUpAndSeparatesDays(t *testing.T) {
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
	_, err := s.Apply(caos.Op{Name: "assign", DripID: drips(t, s)[0].ID, Dripper: ptr(1)})
	must(t, err)
	var orders []string
	for _, d := range drips(t, s) {
		orders = append(orders, d.OrderIDs...)
	}
	if len(orders) != 2 || orders[0] != synced.ID.String() {
		t.Fatalf("操作のときに、その日の注文だけと照らし合わせて追いつく：%v", orders)
	}
}

func TestCaosStoreSerializesConcurrentOps(t *testing.T) {
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
			_, err := s.Apply(caos.Op{Name: "assign", DripID: d.ID, Dripper: ptr(1)})
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
		case caos.StatusBrewing:
			brewing++
		case caos.StatusQueued:
			queued++
		}
	}
	if brewing != 1 || queued != 9 {
		t.Fatalf("同時に割り当てても 1 件ずつ処理され、抽出中は 1 枚：brewing=%d queued=%d", brewing, queued)
	}
}

// 表の制約は Go のモデルのタグから作られる：状態とドリッパーの番号の範囲、1 人のドリッパーが同時に抽出できるのは 1 枚だけ
func TestCaosStoreSchemaConstraints(t *testing.T) {
	db := testDB(t)
	dripper := func(n int) *int { return &n }
	row := func(status caos.Status, d *int) models.CaosDripRow {
		now := time.Now()
		return models.CaosDripRow{ID: uuid.New(), Day: testDay, Status: status, Dripper: d, Lines: []caos.DripLine{}, CreatedAt: now, UpdatedAt: now}
	}
	must(t, db.Create(&[]models.CaosDripRow{row(caos.StatusBrewing, dripper(1)), row(caos.StatusBrewing, dripper(2)), row(caos.StatusQueued, dripper(1)), row(caos.StatusDone, dripper(1))}).Error)
	for name, r := range map[string]models.CaosDripRow{
		"同じドリッパーで 2 枚目の抽出中": row(caos.StatusBrewing, dripper(1)),
		"知らない状態":            row("lost", nil),
		"ドリッパーの番号が範囲外":      row(caos.StatusQueued, dripper(7)),
	} {
		if err := db.Create(&r).Error; err == nil {
			t.Errorf("%s は DB で止まる", name)
		}
	}
}

// 作るものは注文のカップ（注文した時点の品物）から読む。後からメニューの構成が変わっても、カードは変わらない。
// カップを持たない注文（カップを持つ前の注文）は、メニューの構成から読む。
func TestCaosStoreLinesFromCups(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	var champ models.Item
	must(t, db.First(&champ, "abbr = ?", "優勝").Error)

	// メニューは今「ミルク」（カードを作らない品物）だが、注文した時点では「優勝」2 杯だった注文
	o := models.Order{ID: uuid.New(), OrderId: 1, CreatedAt: dayStart.Add(10 * time.Hour), BillingAmount: 500, Received: 500}
	line := models.OrderMenu{ID: uuid.New(), OrderID: o.ID, MenuID: cat.milk, MenuName: "x", UnitPrice: 500}
	o.OrderMenus = []models.OrderMenu{line}
	for i := range 2 {
		o.OrderCups = append(o.OrderCups, models.OrderCup{ID: uuid.New(), OrderID: o.ID, OrderMenuID: line.ID, ItemID: champ.ID, Position: i})
	}
	legacy := createOrder(t, s, db, 2, dayStart.Add(11*time.Hour), cat.champ)
	must(t, db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&o).Error; err != nil {
			return err
		}
		_, err := s.OrdersChanged(tx, []caosOrderRef{{ID: o.ID, CreatedAt: o.CreatedAt}})
		return err
	}))

	cups := map[string]string{}
	for _, d := range drips(t, s) {
		for _, l := range d.Lines {
			cups[l.OrderID] += fmt.Sprintf("%s×%d", l.ItemID, l.Cups)
		}
	}
	if want := fmt.Sprintf("%s×2", champ.ID); cups[o.ID.String()] != want {
		t.Fatalf("カップの品物で作る：%q, want %q", cups[o.ID.String()], want)
	}
	if want := fmt.Sprintf("%s×1", champ.ID); cups[legacy.ID.String()] != want {
		t.Fatalf("カップの無い注文はメニューの構成で作る：%q, want %q", cups[legacy.ID.String()], want)
	}
}

// 明細の指名は番号（dripper）だけを写す。自由記述（assignee）だけの古い明細は指名なし。カップから読むときも、メニューの構成から読むときも同じ
func TestToCaosOrdersCopiesNominatedDripper(t *testing.T) {
	hot := models.ItemType{Name: "hot"}
	champ := models.Item{ID: uuid.New(), Name: "優勝ブレンド", Abbr: "優勝", ItemType: hot}
	menu := models.Menu{MenuItems: []models.MenuItem{{ItemID: champ.ID, Item: champ, Quantity: 1}}}
	free, legacy := "山田", "1st"
	o := models.Order{ID: uuid.New(), OrderId: 1}
	o.OrderMenus = []models.OrderMenu{
		{ID: uuid.New(), Menu: menu, Dripper: ptr(3), Assignee: &free},
		{ID: uuid.New(), Menu: menu, Assignee: &legacy},
		{ID: uuid.New(), Menu: menu},
		{ID: uuid.New(), Menu: menu, Dripper: ptr(5)},
	}
	// 先頭の 3 明細はカップから、最後の明細はメニューの構成から読む
	for _, line := range o.OrderMenus[:3] {
		o.OrderCups = append(o.OrderCups, models.OrderCup{ID: uuid.New(), OrderMenuID: line.ID, ItemID: champ.ID, Item: champ})
	}
	var got []string
	for _, l := range toCaosOrders([]models.Order{o})[0].Lines {
		n := "なし"
		if l.Dripper != nil {
			n = fmt.Sprint(*l.Dripper)
		}
		got = append(got, n)
	}
	if want := []string{"3", "なし", "なし", "5"}; !slices.Equal(got, want) {
		t.Fatalf("明細の番号だけを写す：%v, want %v", got, want)
	}
}

// 指名の番号は jsonb のカードの中身に入り、読み直しても同じ
func TestCaosStoreKeepsNominatedDripper(t *testing.T) {
	db := testDB(t)
	cat := seedCatalog(t, db)
	s := newStore(db)
	o := models.Order{ID: uuid.New(), OrderId: 1, CreatedAt: dayStart.Add(10 * time.Hour), BillingAmount: 500, Received: 500}
	free := "山田"
	o.OrderMenus = []models.OrderMenu{
		{ID: uuid.New(), OrderID: o.ID, MenuID: cat.champ, MenuName: "x", UnitPrice: 500, Dripper: ptr(4), Assignee: &free},
		{ID: uuid.New(), OrderID: o.ID, MenuID: cat.champ, MenuName: "x", UnitPrice: 500},
	}
	must(t, db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&o).Error; err != nil {
			return err
		}
		_, err := s.OrdersChanged(tx, []caosOrderRef{{ID: o.ID, CreatedAt: o.CreatedAt}})
		return err
	}))
	var got []string
	for _, d := range drips(t, s) {
		n := "なし"
		if d.Lines[0].Dripper != nil {
			n = fmt.Sprint(*d.Lines[0].Dripper)
		}
		got = append(got, fmt.Sprintf("%s×%d", n, d.Cups))
	}
	slices.Sort(got)
	if want := []string{"4×1", "なし×1"}; !slices.Equal(got, want) {
		t.Fatalf("指名の番号ごとにカードを作り、保存しても番号が残る：%v", got)
	}
	var raw string
	must(t, db.Raw(`SELECT lines::text FROM caos_drips WHERE lines @> '[{"dripper":4}]'`).Scan(&raw).Error)
	if !strings.Contains(raw, `"dripper": 4`) || strings.Contains(raw, "nominee") {
		t.Fatalf("jsonb には dripper で入る：%s", raw)
	}
}
