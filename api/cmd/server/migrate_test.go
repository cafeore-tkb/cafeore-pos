package main

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	"cafeore-pos/api/internal/testdb"

	"github.com/google/uuid"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 本物の Postgres で、起動時のマイグレーションを確かめる。
//
// プレビューは preview ラベルの付いた PR にしか出ないので、ラベルの無い PR は
// main へのデプロイまで AutoMigrate が通るか分からない。ここで先に確かめる。
//
// migrate も findSchemaDrift も本番と同じく public スキーマを前提にしているので、
// handlers の結合テスト（testdb.New）のような schema 分けではなく、テストごとに
// 使い捨ての database（testdb.NewDatabase）を作って流す。渡した DB の中身には触らないので、
// go test ./... で handlers のテストと並行に走っても壊し合わない。

// 空の DB に反映でき、反映したあとの DB がモデルとずれていないこと。
// 2 回目の起動では何も変えないこと（毎回 ALTER が走ると、デプロイのたびにテーブルをロックする）。
func TestMigrateFromEmpty(t *testing.T) {
	rec := &ddlRecorder{}
	db := testdb.NewDatabase(t, rec)

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	rec.ddl = nil
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if ddl := rec.ddl; len(ddl) > 0 {
		t.Errorf("2 回目の migrate がスキーマを変えた（起動のたびに走る）:\n%s", strings.Join(ddl, "\n"))
	}

	drift, err := findSchemaDrift(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(drift) > 0 {
		t.Errorf("migrate したばかりの DB がモデルとずれている:\n%s", strings.Join(drift, "\n"))
	}
}

// Cloud Run が同時に複数のインスタンスを起動しても、全部起動できること。
func TestMigrateConcurrently(t *testing.T) {
	db := testdb.NewDatabase(t, nil)

	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()

	const instances = 3
	errs := make(chan error, instances)
	for range instances {
		go func() { errs <- migrate(db.WithContext(ctx)) }()
	}
	for range instances {
		if err := <-errs; err != nil {
			t.Fatal(err)
		}
	}

	// 1 つずつ走っていれば、全部のテーブルがそろい、ズレも無い
	drift, err := findSchemaDrift(db)
	if err != nil {
		t.Fatal(err)
	}
	if len(drift) > 0 {
		t.Errorf("同時に migrate したあとの DB がモデルとずれている:\n%s", strings.Join(drift, "\n"))
	}
}

var (
	ddlPattern = regexp.MustCompile(`(?i)^\s*(CREATE|ALTER|DROP)\s`)
	// migrate が毎回流す。入っていれば何もしないので数えない
	noopDDLPattern = regexp.MustCompile(`(?i)^\s*CREATE EXTENSION IF NOT EXISTS\s`)
)

// GORM が流した SQL のうち、スキーマを変えるものだけを覚えておく logger。
// 1 つの goroutine の migrate にだけ使う。
type ddlRecorder struct {
	ddl []string
}

func (r *ddlRecorder) LogMode(logger.LogLevel) logger.Interface { return r }
func (r *ddlRecorder) Info(context.Context, string, ...any)     {}
func (r *ddlRecorder) Warn(context.Context, string, ...any)     {}
func (r *ddlRecorder) Error(context.Context, string, ...any)    {}

func (r *ddlRecorder) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	if sql, _ := fc(); ddlPattern.MatchString(sql) && !noopDDLPattern.MatchString(sql) {
		r.ddl = append(r.ddl, sql)
	}
}

func mustExec(t *testing.T, db *gorm.DB, sql string, args ...any) {
	t.Helper()
	if err := db.Exec(sql, args...).Error; err != nil {
		t.Fatal(err)
	}
}

// 種類の項目を足す前の item_types
type itemTypeBeforeFlags struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key"`
	Name        string    `gorm:"not null"`
	DisplayName string    `gorm:"not null"`
	DeletedAt   gorm.DeletedAt
}

func (itemTypeBeforeFlags) TableName() string { return "item_types" }

type itemTypeFlags struct {
	MakesCup, NeedsBrew, SeniorOnly, IcedBrew bool
}

func readItemTypeFlags(t *testing.T, db *gorm.DB) map[string]itemTypeFlags {
	t.Helper()
	var rows []struct {
		Name                                      string
		MakesCup, NeedsBrew, SeniorOnly, IcedBrew bool
	}
	if err := db.Raw("SELECT name, makes_cup, needs_brew, senior_only, iced_brew FROM item_types").Scan(&rows).Error; err != nil {
		t.Fatal(err)
	}
	got := map[string]itemTypeFlags{}
	for _, r := range rows {
		got[r.Name] = itemTypeFlags{r.MakesCup, r.NeedsBrew, r.SeniorOnly, r.IcedBrew}
	}
	return got
}

// 項目の列を足したときだけ、既存の種類に今までの扱いと同じ値を入れる
func TestMigrateBackfillsItemTypeFlags(t *testing.T) {
	db := testdb.NewDatabase(t, nil)
	if err := db.AutoMigrate(&itemTypeBeforeFlags{}); err != nil {
		t.Fatal(err)
	}
	names := []string{"brend", "gourmet", "hot", "ice", "iceOre", "limited", "milk", "others"}
	for _, name := range names {
		if err := db.Create(&itemTypeBeforeFlags{ID: uuid.New(), Name: name, DisplayName: name}).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 削除済みの種類も同じに扱う
	deleted := itemTypeBeforeFlags{ID: uuid.New(), Name: "ice", DisplayName: "old ice"}
	if err := db.Create(&deleted).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&deleted).Error; err != nil {
		t.Fatal(err)
	}

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	coffee := itemTypeFlags{MakesCup: true, NeedsBrew: true}
	iced := itemTypeFlags{MakesCup: true, NeedsBrew: true, IcedBrew: true}
	want := map[string]itemTypeFlags{
		"brend":   coffee,
		"gourmet": coffee,
		"hot":     coffee,
		"ice":     iced,
		"iceOre":  iced,
		"limited": {MakesCup: true, NeedsBrew: true, SeniorOnly: true},
		"milk":    {MakesCup: true},
		"others":  {},
	}
	got := readItemTypeFlags(t, db)
	for name, w := range want {
		if got[name] != w {
			t.Errorf("%s: got %+v, want %+v", name, got[name], w)
		}
	}
	var deletedIced bool
	if err := db.Raw("SELECT iced_brew FROM item_types WHERE id = ?", deleted.ID).Scan(&deletedIced).Error; err != nil {
		t.Fatal(err)
	}
	if !deletedIced {
		t.Error("deleted ice: iced_brew should be backfilled too")
	}

	// 列があれば二度と走らない（画面で変えた値を戻さない）
	mustExec(t, db, "UPDATE item_types SET iced_brew = false WHERE name = 'ice'")
	mustExec(t, db, "UPDATE item_types SET iced_brew = true WHERE name = 'hot'")
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	got = readItemTypeFlags(t, db)
	if got["ice"].IcedBrew || !got["hot"].IcedBrew {
		t.Errorf("backfill ran again: ice %+v, hot %+v", got["ice"], got["hot"])
	}
}

// 表が無い（空の DB）ときは backfill は走らず、列の既定値で作るだけ
func TestMigrateEmptyDatabase(t *testing.T) {
	db := testdb.NewDatabase(t, nil)
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn("item_types", "iced_brew") {
		t.Fatal("item_types.iced_brew was not created")
	}
}
