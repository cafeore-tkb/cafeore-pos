// api/internal/models/item_type.go
package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ItemType struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	Name        string         `gorm:"not null"`
	DisplayName string         `gorm:"not null"`
	Deleted     gorm.DeletedAt `gorm:"index"`
}

func (item_type *ItemType) BeforeCreate(tx *gorm.DB) error {
	if item_type.ID == uuid.Nil {
		item_type.ID = uuid.New()
	}
	return nil
}
