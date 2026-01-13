// api/internal/models/order_work_item.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type OrderWorkItem struct {
	ID              uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	OrderMenuItemID uuid.UUID `gorm:"type:uuid" index:"idx_order_work_items_order_menu_item_id" json:"order_menu_item_id"`
	ItemID          uuid.UUID `gorm:"type:uuid" json:"item_id"`
  Item            Item
	Status          string    `gorm:"index:idx_order_work_items_status" json:"status"`
	UpdatedAt       time.Time `json:"updated_at"`
	OrderMenuItem   OrderMenuItem `gorm:"foreignKey:OrderMenuItemID"`
}


func (order_work_item *OrderWorkItem) BeforeCreate(tx *gorm.DB) error {
	if order_work_item.ID == uuid.Nil {
		order_work_item.ID = uuid.New()
	}
	return nil
}
