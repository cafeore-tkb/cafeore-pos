// api/internal/models/order.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Order struct {
	ID                uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	OrderId           int       `gorm:"column:order_id;type:bigint;not null"`
	CreatedAt         time.Time `gorm:"not null"`
	ReadyAt           *time.Time
	ServedAt          *time.Time
	BillingAmount     int `gorm:"not null"`
	Received          int `gorm:"not null"`
	DiscountOrderId   int
	DiscountOrderCups int

	OrderMenus []OrderMenu `gorm:"foreignKey:OrderID;references:ID"`
	OrderCups  []OrderCup  `gorm:"foreignKey:OrderID;references:ID"`
	Comments   []Comment   `gorm:"foreignKey:OrderID;references:ID"`
}

func (o *Order) BeforeCreate(tx *gorm.DB) error {
	if o.ID == uuid.Nil {
		o.ID = uuid.New()
	}
	return nil
}
