// api/internal/models/item.go
package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Item struct {
	ID         uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	Name       string         `gorm:"not null"`
	Abbr       string         `gorm:"not null"`
	Price      int            `gorm:"not null"`
	Key        string         `gorm:"not null"`
	Deleted    gorm.DeletedAt `gorm:"index"`
	Assignee   string         `json:"assignee"`

	ItemTypeID uuid.UUID      `gorm:"type:uuid;not null"`
	ItemType   ItemType       `gorm:"foreignKey:ItemTypeID" json:"item_type,omitempty"`
}

func (item *Item) BeforeCreate(tx *gorm.DB) error {
	if item.ID == uuid.Nil {
		item.ID = uuid.New()
	}
	return nil
}
