// api/internal/models/item_type.go
package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ItemType struct {
	ID          uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name        string         `gorm:"not null" json:"name"`
	DisplayName string         `gorm:"not null" json:"display_name"`
	Deleted     gorm.DeletedAt `gorm:"index" json:"-"`
}

func (item_type *ItemType) BeforeCreate(tx *gorm.DB) error {
	if item_type.ID == uuid.Nil {
		item_type.ID = uuid.New()
	}
	return nil
}
