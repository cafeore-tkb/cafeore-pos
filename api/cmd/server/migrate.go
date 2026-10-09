package main

import (
	"fmt"
	"strings"

	"cafeore-pos/api/internal/models"

	"gorm.io/gorm"
)

// 起動時のマイグレーションを 1 つずつ走らせるための advisory lock のキー。
// 値に意味は無く、他で同じキーを使わなければよい。
const migrateLockKey = 7_204_215_001

// migrate は Go のモデル（models.All）を DB のスキーマに反映する。
//
// スキーマの正本はモデルだけで、本番・プレビュー・ローカルのどれも起動時に
// これを通る。SQL を手で流す運用はしない。
//
// 全体を 1 つのトランザクションで行い、その中で pg_advisory_xact_lock を取る。
//   - Cloud Run が複数インスタンスを同時に起動しても、AutoMigrate は 1 つずつ走る
//     （後のインスタンスは差分が無いので何もしない）
//   - Postgres の DDL はトランザクションに入るので、途中で失敗しても半端な
//     スキーマが残らない
//   - ロックはトランザクションの終わりに必ず外れる。Neon の transaction pooler の
//     ように接続が使い回される環境でも、外し忘れて次の起動が止まることがない
//
// 失敗したら起動を止める。Cloud Run では新しいリビジョンが立ち上がらずデプロイが
// 失敗し、トラフィックは前のリビジョンに残る。
//
// AutoMigrate は足りないテーブル・列・インデックスを足すだけで、列の削除や
// 名前の変更はしない。モデルから消した列は DB に残る。
func migrate(db *gorm.DB) error {
	return db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Exec("SELECT pg_advisory_xact_lock(?)", migrateLockKey).Error; err != nil {
			return fmt.Errorf("failed to take migration lock: %w", err)
		}

		// モデルの ID の既定値が uuid_generate_v4() なので、空の DB では先に拡張が要る。
		// 入っていれば何もしない（本番の Supabase は extensions スキーマに入っている）。
		if err := tx.Exec(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`).Error; err != nil {
			return fmt.Errorf("failed to enable uuid-ossp: %w", err)
		}

		if err := migrateItemStockUsageHistory(tx); err != nil {
			return fmt.Errorf("failed to migrate item_stock_usages: %w", err)
		}

		if err := tx.AutoMigrate(models.All()...); err != nil {
			return fmt.Errorf("failed to migrate database: %w", err)
		}
		return nil
	})
}

// 使用量を履歴で持つようにしたとき（2026-10）の一度だけの移行。AutoMigrate は NOT NULL の列を既存の行に
// 足せず、主キーも付け替えないので、ここで valid_from を足して主キーを (item_id, resource_id, valid_from) にする。
// 既存の行は、それより前のどの注文にも効くよう、十分に古い時刻から有効にする。valid_to は AutoMigrate が足す。
// 表が無い（空の DB）か、もう valid_from があれば何もしない。
func migrateItemStockUsageHistory(tx *gorm.DB) error {
	usage := &models.ItemStockUsage{}
	m := tx.Migrator()
	if !m.HasTable(usage) || m.HasColumn(usage, "valid_from") {
		return nil
	}
	var pkey string
	if err := tx.Raw(`SELECT conname FROM pg_constraint WHERE conrelid = 'item_stock_usages'::regclass AND contype = 'p'`).
		Scan(&pkey).Error; err != nil {
		return err
	}
	sqls := []string{
		`ALTER TABLE item_stock_usages ADD COLUMN valid_from timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z'`,
		`ALTER TABLE item_stock_usages ALTER COLUMN valid_from DROP DEFAULT`,
	}
	if pkey != "" {
		sqls = append(sqls, `ALTER TABLE item_stock_usages DROP CONSTRAINT "`+strings.ReplaceAll(pkey, `"`, `""`)+`"`)
	}
	sqls = append(sqls, `ALTER TABLE item_stock_usages ADD PRIMARY KEY (item_id, resource_id, valid_from)`)
	for _, sql := range sqls {
		if err := tx.Exec(sql).Error; err != nil {
			return err
		}
	}
	return nil
}
