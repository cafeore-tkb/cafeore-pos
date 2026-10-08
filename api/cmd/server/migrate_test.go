package main

import (
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 起動時のマイグレーション（migrate.go）を本物の Postgres で走らせる。TEST_DATABASE_URL を渡したときだけ動く。
// migrate は本番と同じく public スキーマを前提にしているので、テストごとに使い捨ての空の database を作って流し、
// 終わったら消す。渡した DB の中身には触らないので、ほかの DB のテストと同じ DB を指しても壊し合わない。
// 接続するロールには CREATEDB が要る。
//
//	TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres go test ./cmd/server/ -run Migrate
//
// TODO: #790 がマージされたら、この準備は #790 の api/internal/testdb（testdb.NewDatabase）に寄せる
// （TEST_DATABASE_URL を読む・無ければスキップ・CI では落とす、の決まりも testdb にまとまっている）。
// 今はまだ testdb が無いので、ここで同じ形の準備をしている。CI に Postgres が無いうちは落とさずスキップする。

func openMigrateTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL がないので、DB を使うテストは飛ばす")
	}
	open := func(dsn string) *gorm.DB {
		t.Helper()
		db, err := gorm.Open(postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}), &gorm.Config{Logger: logger.Discard})
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
	name := "test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	mustExec(t, admin, "CREATE DATABASE "+name)
	// t.Cleanup は後に登録したものから走るので、下で開く接続を閉じてから消す。
	// 閉じ忘れた接続があっても消せるよう FORCE を付ける
	t.Cleanup(func() {
		if err := admin.Exec("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)").Error; err != nil {
			t.Errorf("failed to drop database %s: %v", name, err)
		}
	})
	return open(withDatabase(t, dsn, name))
}

// 接続文字列の database を差し替える。URL でも key=value でもよい。
func withDatabase(t *testing.T, dsn, name string) string {
	t.Helper()
	if !strings.HasPrefix(dsn, "postgres://") && !strings.HasPrefix(dsn, "postgresql://") {
		return dsn + " dbname=" + name
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	u.Path = "/" + name
	return u.String()
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
	rows, err := db.Raw("SELECT name, makes_cup, needs_brew, senior_only, iced_brew FROM item_types").Rows()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = rows.Close() }()
	got := map[string]itemTypeFlags{}
	for rows.Next() {
		var name string
		var f itemTypeFlags
		if err := rows.Scan(&name, &f.MakesCup, &f.NeedsBrew, &f.SeniorOnly, &f.IcedBrew); err != nil {
			t.Fatal(err)
		}
		got[name] = f
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return got
}

// 項目の列を足したときだけ、既存の種類に今までの扱いと同じ値を入れる
func TestMigrateBackfillsItemTypeFlags(t *testing.T) {
	db := openMigrateTestDB(t)
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
	db := openMigrateTestDB(t)
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if !db.Migrator().HasColumn("item_types", "iced_brew") {
		t.Fatal("item_types.iced_brew was not created")
	}
}
