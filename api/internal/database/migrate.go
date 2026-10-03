// Package database は DB のスキーマを api/migrations の SQL に合わせる。
package database

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"cafeore-pos/api/migrations"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

// Migrate は api/migrations のうち、まだ流していないものを番号順に流す。
// どこまで流したかは goose_db_version テーブルに残る。
//
// Cloud Run は同時に複数のインスタンスを起動しうるので、goose_lock テーブルの行で
// 排他する。advisory lock（セッション単位）は Neon の pooler（transaction モード）では
// 効かないので、テーブルを使う方式にしている。
func Migrate(ctx context.Context, db *sql.DB) error {
	locker, err := lock.NewPostgresTableLocker(
		// 既定の 5 分だと、Cloud Run の起動プローブより先に諦められない。
		// ほかのインスタンスが流し終わるのを待つのは 2 分まで
		lock.WithTableLockTimeout(5*time.Second, 24),
	)
	if err != nil {
		return fmt.Errorf("create migration locker: %w", err)
	}

	provider, err := goose.NewProvider(goose.DialectPostgres, db, migrations.FS,
		goose.WithLocker(locker),
		// 並行する PR が 00002 と 00003 を足し、00003 が先にマージされると、本番には
		// 00002 が「抜けた」まま残る。既定ではそこでエラーになり起動できなくなる
		// （CI は空の DB に番号順で流すので気づけない）。抜けた分も後から流す
		goose.WithAllowOutofOrder(true),
	)
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}

	results, err := provider.Up(ctx)
	if err != nil {
		return fmt.Errorf("apply migrations: %w", err)
	}

	if len(results) == 0 {
		log.Println("migrations: already up to date")
		return nil
	}
	for _, r := range results {
		log.Printf("migrations: applied %s (%s)", r.Source.Path, r.Duration)
	}
	return nil
}
