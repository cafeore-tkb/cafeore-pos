package models

// All は DB のテーブルに対応するモデルの一覧。
//
// スキーマを作るのは api/migrations の SQL で、ここは使わない。
// テスト（internal/database）が、SQL を流した DB に AutoMigrate をかけて
// 何も変わらないこと＝モデルと SQL がずれていないことを確かめるのに使う。
// モデルを足したらここにも足すこと。
func All() []any {
	return []any{
		&ItemType{},
		&Item{},
		&Menu{},
		&MenuItem{},
		&Order{},
		&Comment{},
		&OrderMenu{},
		&MasterState{},
		&StockResource{},
		&ItemStockUsage{},
		&StockEvent{},
		&ColorSetting{},
	}
}
