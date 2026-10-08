package main

import (
	"fmt"

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

		pending := pendingBackfills(tx)

		if err := tx.AutoMigrate(models.All()...); err != nil {
			return fmt.Errorf("failed to migrate database: %w", err)
		}

		for _, b := range pending {
			if err := b.fill(tx); err != nil {
				return fmt.Errorf("failed to backfill %s: %w", b.column, err)
			}
		}
		return nil
	})
}

// backfill は、既存の行に入れる値が列の既定値では決まらない列の、最初の値の入れ方。
//
// AutoMigrate は列を足すときに全行へ列の既定値を入れるだけなので、行ごとに違う値が要るときは
// ここに書く。その列がまだ DB に無いとき（＝今回の起動で足すとき）だけ、足した直後に同じ
// トランザクションの中で 1 回だけ走る。そのあと値を変えるのは画面や API の仕事で、ここは二度と走らない。
type backfill struct {
	model  any
	column string
	fill   func(tx *gorm.DB) error
}

var backfills = []backfill{
	// 商品の種類の「カップを作る」「抽出が要る」（2026-10）。それまでは種類の名前で決め打ちしていたので、
	// 既存の種類はそれと同じ結果になる値にする：グッズ（others）はカップを作らない、
	// ミルク（milk）とグッズは抽出しない。ほかは列の既定値（true）のまま。削除済みの種類も同じ。
	{model: &models.ItemType{}, column: "makes_cup", fill: func(tx *gorm.DB) error {
		return tx.Unscoped().Model(&models.ItemType{}).
			Where("name = ?", "others").
			Update("makes_cup", false).Error
	}},
	{model: &models.ItemType{}, column: "needs_brew", fill: func(tx *gorm.DB) error {
		return tx.Unscoped().Model(&models.ItemType{}).
			Where("name IN ?", []string{"milk", "others"}).
			Update("needs_brew", false).Error
	}},
	// 「上級生だけが淹れる（限定）」（2026-10）。CaOS が種類の名前 limited を限定（SP）として扱っていたのと
	// 同じ結果にする：limited だけ true、ほかは列の既定値（false）のまま。
	{model: &models.ItemType{}, column: "senior_only", fill: func(tx *gorm.DB) error {
		return tx.Unscoped().Model(&models.ItemType{}).
			Where("name = ?", "limited").
			Update("senior_only", true).Error
	}},
}

// pendingBackfills は、表はあるのに列がまだ無い backfill を返す。
// 表が無い（空の DB）ときは行も無いので要らない。
func pendingBackfills(tx *gorm.DB) []backfill {
	var pending []backfill
	for _, b := range backfills {
		m := tx.Migrator()
		if m.HasTable(b.model) && !m.HasColumn(b.model, b.column) {
			pending = append(pending, b)
		}
	}
	return pending
}
