package models

// All は DB のスキーマを決めるモデルの一覧。
//
// スキーマの正本はこのモデルだけで、起動時に AutoMigrate で DB へ反映する
// （cmd/server/migrate.go）。テーブルを足したらここにも足すこと。
// ここに無いモデルのテーブルは、本番にもプレビューにも作られない。
// models を使う側のパッケージのモデル（CaOS の caos.Models()）は、cmd/server の schemaModels で足す。
func All() []any {
	return []any{
		&ItemType{},
		&Item{},
		&Menu{},
		&MenuItem{},
		&Order{},
		&Comment{},
		&OrderMenu{},
		&OrderCup{},
		&MasterState{},
		&CashierState{},
		&StockResource{},
		&ItemStockUsage{},
		&StockEvent{},
		&ColorSetting{},
	}
}
