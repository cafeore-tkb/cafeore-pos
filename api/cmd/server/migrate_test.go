package main

import (
	"context"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 本物の Postgres で、起動時のマイグレーションを確かめる。
//
// プレビューは preview ラベルの付いた PR にしか出ないので、ラベルの無い PR は
// main へのデプロイまで AutoMigrate が通るか分からない。ここで先に確かめる。
//
// TEST_DATABASE_URL の Postgres に、テストごとに使い捨ての database を作って流し、
// 終わったら消す。migrate も findSchemaDrift も本番と同じく public スキーマを前提に
// しているので、handlers の結合テスト（newTestDB）のような schema 分けではなく
// database ごと分ける。渡した DB の中身には触らないので、go test ./... で handlers の
// テストと並行に走っても壊し合わない。
//
// TEST_DATABASE_URL が無ければスキップする。CI（CI=true）では必ず要るので、無ければ落とす。
// 接続するロールには CREATEDB が要る（CI と api/compose.yaml の postgres は持っている）。
func openEmptyTestDB(t *testing.T) (*gorm.DB, *ddlRecorder) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		if os.Getenv("CI") != "" {
			t.Fatal("TEST_DATABASE_URL is required in CI")
		}
		t.Skip("TEST_DATABASE_URL is not set")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("TEST_DATABASE_URL を読めない: %v", err)
	}

	admin := openMigrateTestDB(t, *config, logger.Default.LogMode(logger.Silent))
	name := "test_migrate_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := admin.Exec("CREATE DATABASE " + name).Error; err != nil {
		t.Fatal(err)
	}
	// t.Cleanup は後に登録したものから走るので、下で開く接続を閉じてから消す。
	// 閉じ忘れた接続があっても消せるよう FORCE を付ける
	t.Cleanup(func() {
		if err := admin.Exec("DROP DATABASE IF EXISTS " + name + " WITH (FORCE)").Error; err != nil {
			t.Errorf("failed to drop database %s: %v", name, err)
		}
	})

	rec := &ddlRecorder{}
	config.Database = name
	return openMigrateTestDB(t, *config, rec), rec
}

// initDB と同じ設定（simple protocol・外部キーを作らない）で開く
func openMigrateTestDB(t *testing.T, config pgx.ConnConfig, log logger.Interface) *gorm.DB {
	t.Helper()
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	sqlDB := stdlib.OpenDB(config)
	t.Cleanup(func() { _ = sqlDB.Close() })

	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		PrepareStmt:                              false,
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   log,
	})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

// 空の DB に反映でき、反映したあとの DB がモデルとずれていないこと。
// 2 回目の起動では何も変えないこと（毎回 ALTER が走ると、デプロイのたびにテーブルをロックする）。
func TestMigrateFromEmpty(t *testing.T) {
	db, rec := openEmptyTestDB(t)

	if err := migrate(db); err != nil {
		t.Fatal(err)
	}

	rec.reset()
	if err := migrate(db); err != nil {
		t.Fatal(err)
	}
	if ddl := rec.statements(); len(ddl) > 0 {
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
	db, _ := openEmptyTestDB(t)

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
type ddlRecorder struct {
	mu  sync.Mutex
	ddl []string
}

func (r *ddlRecorder) LogMode(logger.LogLevel) logger.Interface { return r }
func (r *ddlRecorder) Info(context.Context, string, ...any)     {}
func (r *ddlRecorder) Warn(context.Context, string, ...any)     {}
func (r *ddlRecorder) Error(context.Context, string, ...any)    {}

func (r *ddlRecorder) Trace(_ context.Context, _ time.Time, fc func() (string, int64), _ error) {
	sql, _ := fc()
	if !ddlPattern.MatchString(sql) || noopDDLPattern.MatchString(sql) {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ddl = append(r.ddl, sql)
}

func (r *ddlRecorder) reset() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.ddl = nil
}

func (r *ddlRecorder) statements() []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]string(nil), r.ddl...)
}
