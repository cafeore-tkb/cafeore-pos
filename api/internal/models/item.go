// api/internal/models/item.go
package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Item struct {
	ID         uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name       string         `json:"name"`
	ItemTypeID uuid.UUID      `gorm:"type:uuid;not null;index" json:"item_type_id"`
	Abbr       string         `json:"abbr"`
	Key        string         `json:"key"`
	Deleted    gorm.DeletedAt

	ItemType   ItemType       `gorm:"foreignKey:ItemTypeID;references:ID" json:"item_type"`
}

func (item *Item) BeforeCreate(tx *gorm.DB) error {
	if item.ID == uuid.Nil {
		item.ID = uuid.New()
	}
	return nil
}
