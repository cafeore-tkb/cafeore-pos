package models

import "github.com/google/uuid"

type OrderMenu struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	OrderID   uuid.UUID `gorm:"type:uuid;not null;index"`
	MenuID    uuid.UUID `gorm:"type:uuid;not null;index"`
	Assignee  *string
	MenuName  string `gorm:"not null"`
	UnitPrice int    `gorm:"not null"`

	Menu Menu `gorm:"foreignKey:MenuID;references:ID"`
	// この明細で減る在庫。注文を受けたときに決めて、編集しても引き継ぐ
	StockUsages []OrderStockUsage `gorm:"foreignKey:OrderMenuID;references:ID"`
}
