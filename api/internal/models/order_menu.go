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
}
