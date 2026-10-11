// Package testdb は本物の Postgres を使うテストの DB を開く。
//
//	TEST_DATABASE_URL=postgres://postgres@localhost:5432/postgres go test ./...
package testdb

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

// Open はテストごとに使い捨ての schema を作って開き、終わったら消す。TEST_DATABASE_URL が無ければ skip する。
// 渡した DB の中身には触らない。uuid_generate_v4() は DB の public に入れ、
// search_path を「その schema,public」にして使う。
func Open(t *testing.T) *gorm.DB {
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
	if err := admin.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public`).Error; err != nil {
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

	searchPath := schema + ",public"
	if !strings.HasPrefix(dsn, "postgres://") && !strings.HasPrefix(dsn, "postgresql://") {
		return open(dsn + " search_path=" + searchPath)
	}
	u, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", searchPath)
	u.RawQuery = q.Encode()
	return open(u.String())
}
