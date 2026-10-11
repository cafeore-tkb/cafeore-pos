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

		if err := tx.AutoMigrate(models.All()...); err != nil {
			return fmt.Errorf("failed to migrate database: %w", err)
		}

		for _, b := range backfills {
			if err := tx.Unscoped().Model(itemType).Where("name IN ?", b.names).Update(b.column, b.value).Error; err != nil {
				return fmt.Errorf("failed to backfill item_types.%s: %w", b.column, err)
			}
		}

		for _, sql := range valueRenames {
			if err := tx.Exec(sql).Error; err != nil {
				return fmt.Errorf("failed to rename values: %w", err)
			}
		}
		return nil
	})
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
