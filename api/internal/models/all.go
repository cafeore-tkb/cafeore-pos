package models

// All は DB のスキーマを決めるモデルの一覧。
//
// スキーマの正本はこのモデルだけで、起動時に AutoMigrate で DB へ反映する
// （cmd/server/migrate.go）。テーブルを足したらここにも足すこと。
// ここに無いモデルのテーブルは、本番にもプレビューにも作られない。
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
		&CaosClientLog{},
		&CaosOperation{},
		&CaosOperationCup{},
		&OrderPayment{},
		&CupEmergency{},
		&MasterState{},
		&CashierState{},
		&StockResource{},
		&StockResourceItemType{},
		&OrderStockUsage{},
		&CupEmergencyStockUsage{},
		&StockEvent{},
		&ColorSetting{},
		&DripperAssignee{},
		&DripperAssigneeChange{},
		&SquareCheckout{},
		&SquareAction{},
		&SquareDevice{},
		&PrinterSetting{},
		&LabelPrintRequest{},
		&LabelPrintProxy{},
	}
}
