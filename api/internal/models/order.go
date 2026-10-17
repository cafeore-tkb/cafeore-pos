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
	// "cash" か "square"。Square の決済は square_checkouts.order_id から引く。
	// 個別会計（Payments）では、Square の支払いを含めば "square"。
	PaymentMethod string `gorm:"not null;default:'cash'"`

	OrderMenus []OrderMenu `gorm:"foreignKey:OrderID;references:ID"`
	OrderCups  []OrderCup  `gorm:"foreignKey:OrderID;references:ID"`
	Comments   []Comment   `gorm:"foreignKey:OrderID;references:ID"`
	// 個別会計の支払い（払った順）。一括で払った注文では空
	Payments []OrderPayment `gorm:"foreignKey:OrderID;references:ID"`

	// この注文に使った Square の決済（返金の状態を応答に載せるのに使う）。個別会計では複数ある。
	// DB の列でも関連でもなく、読んだあとに handlers の attachSquareCheckouts で埋める。関連にすると
	// AutoMigrate が square_checkouts.order_id に外部キーを張ってしまう。
	SquareCheckouts []SquareCheckout `gorm:"-"`
}

func (o *Order) BeforeCreate(tx *gorm.DB) error {
	if o.ID == uuid.Nil {
		o.ID = uuid.New()
	}
	return nil
}
