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

		splitStock, err := prepareItemStockMigration(tx)
		if err != nil {
			return fmt.Errorf("failed to prepare stock_resources: %w", err)
		}

		if err := tx.AutoMigrate(models.All()...); err != nil {
			return fmt.Errorf("failed to migrate database: %w", err)
		}

		for _, b := range backfills {
			if err := tx.Unscoped().Model(itemType).Where("name IN ?", b.names).Update(b.column, b.value).Error; err != nil {
				return fmt.Errorf("failed to backfill item_types.%s: %w", b.column, err)
			}
		}

		if splitStock {
			if err := migrateItemStock(tx); err != nil {
				return fmt.Errorf("failed to migrate item stock: %w", err)
			}
		}
		return nil
	})
}

// 在庫をアイテムの在庫とカップの 2 種類にしたとき（2026-10）の一度だけの移行。stock_resources に item_id が無ければ流す。
// AutoMigrate は check を名前で見て付け替えないので、ここで kind の check を外す（AutoMigrate が新しい check を付ける）。
// 豆（kind bean）はアイテムに結べないので、棚卸し・入荷の記録ごと消す。
func prepareItemStockMigration(tx *gorm.DB) (bool, error) {
	m := tx.Migrator()
	resource := &models.StockResource{}
	if m.HasColumn(resource, "item_id") {
		return false, nil
	}
	if !m.HasTable(resource) {
		return true, nil
	}
	for _, sql := range []string{
		`ALTER TABLE stock_resources DROP CONSTRAINT IF EXISTS chk_stock_resources_kind`,
		`DELETE FROM stock_events WHERE resource_id IN (SELECT id FROM stock_resources WHERE kind = 'bean')`,
		`DELETE FROM stock_resources WHERE kind = 'bean'`,
	} {
		if err := tx.Exec(sql).Error; err != nil {
			return false, err
		}
	}
	return true, nil
}

// AutoMigrate の後に、今のアイテムそれぞれの在庫を作る。使用量の表（item_stock_usages）があれば、
// 前からある注文で減った量をその表から 1 回だけ埋めて、表を消す。カップの使う種類は空で始める。
func migrateItemStock(tx *gorm.DB) error {
	var items []models.Item
	if err := tx.Find(&items).Error; err != nil {
		return err
	}
	if len(items) > 0 {
		resources := make([]models.StockResource, len(items))
		for i, item := range items {
			resources[i] = models.NewItemStockResource(item.ID)
		}
		if err := tx.Create(&resources).Error; err != nil {
			return err
		}
	}
	if !tx.Migrator().HasTable("item_stock_usages") {
		return nil
	}
	// 消した豆の行は stock_resources と結んで落とす
	if err := tx.Exec(`
		INSERT INTO order_stock_usages (order_menu_id, resource_id, order_id, servings, amount)
		SELECT om.id, u.resource_id, om.order_id, SUM(mi.quantity), SUM(mi.quantity * u.amount)
		FROM order_menus om
		JOIN menu_items mi ON mi.menu_id = om.menu_id
		JOIN item_stock_usages u ON u.item_id = mi.item_id
		JOIN stock_resources r ON r.id = u.resource_id
		GROUP BY om.id, u.resource_id, om.order_id`).Error; err != nil {
		return err
	}
	return tx.Exec(`DROP TABLE item_stock_usages`).Error
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
