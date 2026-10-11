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

		// AutoMigrate は足した列の全行に列の既定値を入れるだけなので、種類ごとに違う最初の値は
		// 列を足した直後に入れる。列がもう DB にあれば走らない（あとで画面や API で変えた値を戻さない）。
		// 表が無い（空の DB）ときは行も無いので要らない。
		itemType := &models.ItemType{}
		m := tx.Migrator()
		var backfills []itemTypeBackfill
		if m.HasTable(itemType) {
			for _, b := range itemTypeBackfills {
				if !m.HasColumn(itemType, b.column) {
					backfills = append(backfills, b)
				}
			}
		}

		if err := tx.AutoMigrate(models.All()...); err != nil {
			return fmt.Errorf("failed to migrate database: %w", err)
		}

		for _, b := range backfills {
			if err := tx.Unscoped().Model(itemType).Where("name IN ?", b.names).Update(b.column, b.value).Error; err != nil {
				return fmt.Errorf("failed to backfill item_types.%s: %w", b.column, err)
			}
		}
		return nil
	})
}

type itemTypeBackfill struct {
	column string
	value  bool
	names  []string
}

// 商品の種類の項目（2026-10）を足したときの、既存の種類の最初の値。それまで種類の名前で決め打ちしていたのと
// 同じ結果になるよう、列の既定値と違う値になる種類だけを書く（削除済みの種類も同じ）。一度だけの移行で、
// これ以降は商品管理で設定した値だけを使う。
//   - グッズ（others）はカップを作らない。ミルク（milk）とグッズは抽出しない
//   - CaOS が限定（SP）として扱っていた limited だけ上級生のみ
//   - アイス（ice）とアイスオレ（iceOre）だけアイスで淹れる
var itemTypeBackfills = []itemTypeBackfill{
	{column: "makes_cup", value: false, names: []string{"others"}},
	{column: "needs_brew", value: false, names: []string{"milk", "others"}},
	{column: "senior_only", value: true, names: []string{"limited"}},
	{column: "iced_brew", value: true, names: []string{"ice", "iceOre"}},
}
