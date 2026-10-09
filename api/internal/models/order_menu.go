package models

import "github.com/google/uuid"

type OrderMenu struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	OrderID   uuid.UUID `gorm:"type:uuid;not null;index"`
	MenuID    uuid.UUID `gorm:"type:uuid;not null;index"`
	Assignee  *string
	MenuName  string `gorm:"not null"`
	UnitPrice int    `gorm:"not null"`
	// 注文した時点のメニューの構成（OrderMenuItem の配列）。カップを作らない品物も含む。
	// 在庫の消費はこれで数える（handlers/inventory.go の orderItemsSQL）。NULL は構成を持たない明細。
	Items JSONB `gorm:"type:jsonb"`

	Menu Menu `gorm:"foreignKey:MenuID;references:ID"`
}

// OrderMenuItem は OrderMenu.Items の1つ。注文した時点のメニューの構成品（MenuItem）の写し。
type OrderMenuItem struct {
	ItemID   uuid.UUID `json:"item_id"`
	Quantity int       `json:"quantity"`
}
