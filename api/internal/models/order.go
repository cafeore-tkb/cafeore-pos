// api/internal/models/order.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Order struct {
	ID                uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	OrderId           int            `json:"order_id"`
	CreatedAt         time.Time      `json:"created_at"`
	ReadyAt           *time.Time     `json:"ready_at,omitempty"`
	ServedAt          *time.Time     `json:"served_at,omitempty"`
	BillingAmount     int            `json:"billing_amount"`
	Received          int            `json:"received"`
	DiscountOrderId   uuid.UUID      `gorm:"type:uuid" json:"discount_order_id,omitempty"`
	DiscountOrderCups int            `json:"discount_order_cups"`

	Items    []Item    `gorm:"many2many:order_items;" json:"items,omitempty"`
	Comments []Comment `gorm:"foreignKey:OrderID;references:ID" json:"comments,omitempty"`
}

func (o *Order) BeforeCreate(tx *gorm.DB) error {
	if o.ID == uuid.Nil {
		o.ID = uuid.New()
	}
	return nil
}
