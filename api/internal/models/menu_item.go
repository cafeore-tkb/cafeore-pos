// api/internal/models/menu_item.go
package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type MenuItem struct {
	ID    uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	Name  string    `json:"name"`
	Price int       `json:"price"`

  Items []Item    `gorm:"many2many:item_menu_items"`
}

func (menu_item *MenuItem) BeforeCreate(tx *gorm.DB) error {
	if menu_item.ID == uuid.Nil {
		menu_item.ID = uuid.New()
	}
	return nil
}
