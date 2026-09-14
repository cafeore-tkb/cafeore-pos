package models

import "github.com/google/uuid"

type MenuItem struct {
	MenuID   uuid.UUID `gorm:"type:uuid;primaryKey"`
	ItemID   uuid.UUID `gorm:"type:uuid;primaryKey"`
	Quantity int       `gorm:"not null;check:quantity > 0"`

	Menu Menu `gorm:"foreignKey:MenuID;references:ID"`
	Item Item `gorm:"foreignKey:ItemID;references:ID"`
}
