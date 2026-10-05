package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Menu struct {
	ID        uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	Name      string         `gorm:"not null"`
	Abbr      string         `gorm:"not null"`
	Price     int            `gorm:"not null"`
	Key       string         `gorm:"not null;uniqueIndex"`
	DeletedAt gorm.DeletedAt `gorm:"index"`

	MenuItems []MenuItem `gorm:"foreignKey:MenuID;references:ID"`
}

func (menu *Menu) BeforeCreate(tx *gorm.DB) error {
	if menu.ID == uuid.Nil {
		menu.ID = uuid.New()
	}
	return nil
}
