// api/internal/models/order_menu_item.go
package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)


type OrderMenuItem struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	OrderID    uuid.UUID `gorm:"type:uuid" json:"order_id"`
	Order      Order     `gorm:"foreignKey:OrderID"`

	MenuItemID uuid.UUID `gorm:"type:uuid" json:"menu_item_id"`
	MenuItem   MenuItem

	WorkItems []OrderWorkItem
}

func (order_menu_item *OrderMenuItem) BeforeCreate(tx *gorm.DB) error {
	if order_menu_item.ID == uuid.Nil {
		order_menu_item.ID = uuid.New()
	}
	return nil
}
