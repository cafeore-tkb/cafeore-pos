package models

import (
	"github.com/google/uuid"
)

type OrderItem struct {
  OrderID  uuid.UUID `gorm:"type:uuid;not null;index"`
	ItemID   uuid.UUID `gorm:"type:uuid;not null;index"`

	Order    Order     `gorm:"foreignKey:OrderID;references:ID;"`
	Item     Item      `gorm:"foreignKey:ItemID;references:ID;"`

	Assignee *string
}
