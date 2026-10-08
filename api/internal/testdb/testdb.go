// Package testdb は、本物の Postgres を使うテストの DB を用意する。
//
// 接続先はどのテストも TEST_DATABASE_URL の 1 つだけ。本物の DB を使うテストを足すときは、
// 別の環境変数を作らずここを使う。
//
//   - TEST_DATABASE_URL が無ければスキップする
//   - CI（CI=true）では必ず要るので、無ければ落とす（黙って飛ばされないように）
//
// go test ./... はパッケージを並行で走らせ、どのパッケージのテストも同じ DB を共有する。
// そのため渡した DB の既存の schema・データには触らず、テストごとに使い捨ての schema（New）か
// database（NewDatabase）を作り、終わったら消す。手元での流し方は README の「backend のテスト」。
package testdb

import (
	"os"
	"strings"
	"testing"

	"cafeore-pos/api/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// EnvURL は、本物の DB を使うテストの接続先を渡す環境変数。
const EnvURL = "TEST_DATABASE_URL"

// uuid-ossp を入れるときに取る advisory lock の番号。値に意味はなく、ほかと重ならなければよい。
const extensionLockKey = 0x7465737464627831

// TEST_DATABASE_URL を読んで返す。無ければスキップし、CI では落とす。
// 呼ぶたびに読み直すので、返した RuntimeParams を書き換えてもほかの接続に響かない。
func connConfig(t testing.TB) pgx.ConnConfig {
	t.Helper()
	dsn := os.Getenv(EnvURL)
	if dsn == "" {
		if os.Getenv("CI") != "" {
			t.Fatal(EnvURL + " is required in CI")
		}
		t.Skip(EnvURL + " is not set")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("failed to parse %s: %v", EnvURL, err)
	}
	return *config
}

// New は、テストごとに使い捨ての schema を作り、起動時と同じくモデル（models.All）から
// テーブルを作った DB を返す。テストどうしでデータが混ざらず、終わったら schema ごと消す。
//
// uuid_generate_v4() は DB の public に入れ、search_path を「その schema,public」にして使う。
func New(t testing.TB) *gorm.DB {
	t.Helper()
	admin := open(t, connConfig(t), nil)
	ensureUUIDExtension(t, admin)

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

	schemaConfig := connConfig(t)
	schemaConfig.RuntimeParams["search_path"] = schema + ",public"
	db := open(t, schemaConfig, nil)
	// スキーマの正本はモデル。本番の起動時（cmd/server/migrate.go）と同じく AutoMigrate で作る
	if err := db.AutoMigrate(models.All()...); err != nil {
		t.Fatal(err)
	}
	return db
}

// NewDatabase は、テストごとに使い捨ての空の database を作って開く。終わったら消す。
//
// 起動時のマイグレーションのように public スキーマを前提にするテスト用。
// 接続するロールに CREATEDB が要る（CI と api/compose.yaml の postgres は持っている）。
// log が nil なら SQL のログは出さない。
func NewDatabase(t testing.TB, log logger.Interface) *gorm.DB {
	t.Helper()
	config := connConfig(t)

	admin := open(t, config, nil)
	name := "test_" + strings.ReplaceAll(uuid.NewString(), "-", "")
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

	config.Database = name
	return open(t, config, log)
}

// 本番（cmd/server の initDB）と同じ設定（simple protocol・外部キーを作らない）で開き、
// テストが終わったら閉じる。log が nil なら SQL のログは出さない
// （見つからないこと（404）を確かめるテストも多いので）。
func open(t testing.TB, config pgx.ConnConfig, log logger.Interface) *gorm.DB {
	t.Helper()
	if log == nil {
		log = logger.Default.LogMode(logger.Silent)
	}
	config.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol
	sqlDB := stdlib.OpenDB(config)
	t.Cleanup(func() { _ = sqlDB.Close() })

	db, err := gorm.Open(postgres.New(postgres.Config{Conn: sqlDB}), &gorm.Config{
		DisableForeignKeyConstraintWhenMigrating: true,
		Logger:                                   log,
	})
	if err != nil {
		t.Fatal(err)
	}
	return db
}

// uuid-ossp を DB の public に入れる。ほかのテスト（別のパッケージのテストのプロセスを含む）と
// 同時に CREATE EXTENSION するとぶつかるので、advisory lock で 1 つずつにする。
func ensureUUIDExtension(t testing.TB, admin *gorm.DB) {
	t.Helper()
	err := admin.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", extensionLockKey).Error; err != nil {
			return err
		}
		return tx.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp" SCHEMA public`).Error
	})
	if err != nil {
		t.Fatal(err)
	}
}
