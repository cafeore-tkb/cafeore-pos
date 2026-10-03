package database

import (
	"context"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"cafeore-pos/api/internal/models"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// 本物の Postgres が要るので、TEST_DATABASE_URL が無ければ飛ばす。
// CI（api-ci.yml）はサービスの Postgres を渡している。
// **渡した DB の public スキーマは丸ごと消える。** 捨ててよい DB を渡すこと。
func openTestDB(t *testing.T) (*gorm.DB, *ddlRecorder) {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}

	rec := &ddlRecorder{}
	db, err := gorm.Open(
		postgres.New(postgres.Config{DSN: dsn, PreferSimpleProtocol: true}),
		// アプリ（cmd/server）と同じ設定にそろえる
		&gorm.Config{DisableForeignKeyConstraintWhenMigrating: true, Logger: rec},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public").Error; err != nil {
		t.Fatal(err)
	}
	return db, rec
}

func migrate(t *testing.T, db *gorm.DB) {
	t.Helper()
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	if err := Migrate(ctx, sqlDB); err != nil {
		t.Fatal(err)
	}
}

// SQL を流した DB に AutoMigrate をかけて、モデルとの差分（AutoMigrate が流す DDL）を返す。
func autoMigrateDiff(t *testing.T, db *gorm.DB, rec *ddlRecorder) []string {
	t.Helper()
	rec.reset()
	if err := db.AutoMigrate(models.All()...); err != nil {
		t.Fatal(err)
	}
	return rec.statements()
}

// モデルを変えたのに api/migrations に SQL を足し忘れると、ここで落ちる。
// 列を消す・名前を変えるといった変更は AutoMigrate が流さないので、ここでは検出できない。
func TestMigrationsMatchModels(t *testing.T) {
	db, rec := openTestDB(t)
	migrate(t, db)

	if ddl := autoMigrateDiff(t, db, rec); len(ddl) > 0 {
		t.Fatalf("api/migrations のスキーマがモデルとずれている。次の変更をマイグレーションとして足すこと:\n%s",
			strings.Join(ddl, "\n"))
	}
}

// 本番や既存のプレビュー DB は、goose を入れる前に AutoMigrate で（または同じ形を手で）作られている。
// そこへ基準の SQL を流しても失敗せず、何も壊さないこと。
func TestBaselineOnExistingSchema(t *testing.T) {
	db, rec := openTestDB(t)
	if err := db.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(models.All()...); err != nil {
		t.Fatal(err)
	}

	migrate(t, db)
	// 2 回目は何も流さない
	migrate(t, db)

	if ddl := autoMigrateDiff(t, db, rec); len(ddl) > 0 {
		t.Fatalf("基準の SQL が既存のスキーマを変えた:\n%s", strings.Join(ddl, "\n"))
	}
}

var ddlPattern = regexp.MustCompile(`(?i)^\s*(CREATE|ALTER|DROP)\s`)

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
	if !ddlPattern.MatchString(sql) {
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
