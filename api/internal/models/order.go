// api/internal/models/order.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Order struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	OrderId   int       `gorm:"column:order_id;type:bigint;not null"`
	CreatedAt time.Time `gorm:"not null"`
	ReadyAt   *time.Time
	ServedAt  *time.Time
	// キャンセルした時刻。キャンセルしても注文は消さずに残す（handlers/order_cancel.go）
	CancelledAt *time.Time
	// 現金で受け取った分を返した時刻（handlers/order_cancel.go）
	CashRefundedAt    *time.Time
	BillingAmount     int `gorm:"not null"`
	Received          int `gorm:"not null"`
	DiscountOrderId   int
	DiscountOrderCups int
	// "cash" か "square"。Square の決済は square_checkouts.order_id から引く。
	// 個別会計（Payments）では、Square の支払いを含めば "square"。
	PaymentMethod string `gorm:"not null;default:'cash'"`
	// 分けた元の注文（分けた注文の 1 つ目）。レジが 1 人の注文を注文番号ごとに分けて作った 2 つ目以降に付く。
	// 支払いは 1 つ目の注文がまとめて持つ（2 つ目以降のお預かりは 0）。キャンセル・返金・削除は分けた注文を
	// まとめて扱う（handlers/split_group.go）
	SplitParentID *uuid.UUID `gorm:"type:uuid;index"`

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
