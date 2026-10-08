package main

import (
	"context"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"cafeore-pos/api/internal/testdb"

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
//
// 接続先（TEST_DATABASE_URL）の決まりは testdb にまとめてある。無ければスキップし、CI では落とす。
// 接続するロールには CREATEDB が要る（CI と api/compose.yaml の postgres は持っている）。
func openEmptyTestDB(t *testing.T) (*gorm.DB, *ddlRecorder) {
	t.Helper()
	rec := &ddlRecorder{}
	return testdb.NewDatabase(t, rec), rec
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
