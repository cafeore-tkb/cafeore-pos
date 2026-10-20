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

		// AutoMigrate は表の名前を変えず新しい表を作ってしまうので、名前を変えた表は先に変えておく。
		m := tx.Migrator()
		for _, r := range tableRenames {
			if !m.HasTable(r.from) || m.HasTable(r.to) {
				continue
			}
			for _, sql := range r.sql {
				if err := tx.Exec(sql).Error; err != nil {
					return fmt.Errorf("failed to rename %s to %s: %w", r.from, r.to, err)
				}
			}
		}

		// AutoMigrate は足した列の全行に列の既定値を入れるだけなので、種類ごとに違う最初の値は
		// 列を足した直後に入れる。列がもう DB にあれば走らない（あとで画面や API で変えた値を戻さない）。
		// 表が無い（空の DB）ときは行も無いので要らない。
		itemType := &models.ItemType{}
		var backfills []itemTypeBackfill
		if m.HasTable(itemType) {
			for _, b := range itemTypeBackfills {
				if !m.HasColumn(itemType, b.column) {
					backfills = append(backfills, b)
				}
			}
		}

		if err := dropOldMenuKeyIndex(tx); err != nil {
			return fmt.Errorf("failed to drop idx_menus_key: %w", err)
		}

		if err := dropUniqueSquareCheckoutOrderIndex(tx); err != nil {
			return fmt.Errorf("failed to drop idx_square_checkouts_order_id: %w", err)
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

		// 新しい列が既にあっても、旧リビジョンなどが残した使用量の表を回収する。
		if err := migrateLegacyStockUsages(tx); err != nil {
			return fmt.Errorf("failed to migrate legacy stock usages: %w", err)
		}

		for _, sql := range valueRenames {
			if err := tx.Exec(sql).Error; err != nil {
				return fmt.Errorf("failed to rename values: %w", err)
			}
		}
		return nil
	})
}

// メニューのキーの一意の索引を、消していないメニューの中だけの部分索引にしたとき（2026-10）の移行。
// AutoMigrate は同じ名前の索引があると作り直さないので、前の形（WHERE の無い索引）なら消しておく（AutoMigrate が部分索引で作り直す）。
func dropOldMenuKeyIndex(tx *gorm.DB) error {
	var old bool
	if err := tx.Raw(`SELECT EXISTS (
		SELECT 1 FROM pg_indexes
		WHERE schemaname = current_schema() AND indexname = 'idx_menus_key' AND indexdef NOT LIKE '% WHERE %')`).
		Scan(&old).Error; err != nil {
		return err
	}
	if !old {
		return nil
	}
	return tx.Exec(`DROP INDEX idx_menus_key`).Error
}

// 個別会計で 1 つの注文に Square の決済を複数結び付けるようにしたとき（2026-10）の移行。
// square_checkouts.order_id の索引を一意でない索引にする。AutoMigrate は同じ名前の索引があると作り直さないので、
// 一意の索引なら消しておく（AutoMigrate が一意でない索引で作り直す）。
func dropUniqueSquareCheckoutOrderIndex(tx *gorm.DB) error {
	var unique bool
	if err := tx.Raw(`SELECT EXISTS (
		SELECT 1 FROM pg_indexes
		WHERE schemaname = current_schema() AND indexname = 'idx_square_checkouts_order_id' AND indexdef LIKE 'CREATE UNIQUE INDEX %')`).
		Scan(&unique).Error; err != nil {
		return err
	}
	if !unique {
		return nil
	}
	return tx.Exec(`DROP INDEX idx_square_checkouts_order_id`).Error
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

// AutoMigrate の後に、今のアイテムそれぞれの在庫を作る。カップの使う種類は空で始める。
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
	return nil
}

// 旧使用量の表が残っていれば注文の履歴を補完して消す。既存の履歴は注文時の値なので上書きしない。
// item_id の有無とは別に実行し、新旧の表が共存する DB でも在庫対象を重複して作らない。
func migrateLegacyStockUsages(tx *gorm.DB) error {
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
		GROUP BY om.id, u.resource_id, om.order_id
		ON CONFLICT (order_menu_id, resource_id) DO NOTHING`).Error; err != nil {
		return err
	}
	return tx.Exec(`DROP TABLE item_stock_usages`).Error
}

// 名前を変えた表。前の名前（from）の表があって今の名前（to）の表が無いときだけ sql を流す。
// 表と一緒に、前の名前の入った主キー・CHECK・索引・連番の名前も、空の DB に AutoMigrate で作るときと同じ名前に変える
// （CHECK と索引は名前で有無を見るので、変えないと AutoMigrate が同じものをもう 1 つ作る）。
var tableRenames = []struct {
	from, to string
	sql      []string
}{
	// ドリッパーの担当者（2026-10）
	{from: "caos_lanes", to: "dripper_assignees", sql: []string{
		`ALTER TABLE caos_lanes RENAME TO dripper_assignees`,
		`ALTER TABLE dripper_assignees RENAME CONSTRAINT caos_lanes_pkey TO dripper_assignees_pkey`,
		`ALTER TABLE dripper_assignees RENAME CONSTRAINT caos_lanes_dripper_check TO dripper_assignees_dripper_check`,
	}},
	// ドリッパーの担当者の交代の記録（2026-10）
	{from: "caos_lane_changes", to: "dripper_assignee_changes", sql: []string{
		`ALTER TABLE caos_lane_changes RENAME TO dripper_assignee_changes`,
		`ALTER TABLE dripper_assignee_changes RENAME CONSTRAINT caos_lane_changes_pkey TO dripper_assignee_changes_pkey`,
		`ALTER TABLE dripper_assignee_changes RENAME CONSTRAINT caos_lane_changes_dripper_check TO dripper_assignee_changes_dripper_check`,
		`ALTER INDEX idx_caos_lane_changes_day RENAME TO idx_dripper_assignee_changes_day`,
		`ALTER SEQUENCE caos_lane_changes_id_seq RENAME TO dripper_assignee_changes_id_seq`,
	}},
}

// 名前を変えた、DB に入る値。前の名前の行が無ければ何も変えないので、起動のたびに流す
// （デプロイの切り替えの間に前の版のインスタンスが前の名前で書いても、次の起動で直る）。
var valueRenames = []string{
	// 色の設定の画面（2026-10。caos_nominated → nominated）。同じ対象に今の名前の行があれば、前の名前の行は消す（一意制約）
	`UPDATE color_settings o SET screen = 'nominated' WHERE screen = 'caos_nominated' AND NOT EXISTS (
		SELECT 1 FROM color_settings n WHERE n.target_type = o.target_type AND n.target_id = o.target_id AND n.screen = 'nominated')`,
	`DELETE FROM color_settings WHERE screen = 'caos_nominated'`,
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
