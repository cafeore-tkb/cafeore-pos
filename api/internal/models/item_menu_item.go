// api/internal/models/item_menu_item.go
package models

import (
	"github.com/google/uuid"
)

type ItemMenuItem struct {
	ItemID     uuid.UUID `gorm:"type:uuid;primaryKey"`
	MenuItemID uuid.UUID `gorm:"type:uuid;primaryKey"`
}
