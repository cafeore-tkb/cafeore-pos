// api/internal/models/order_payment.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// OrderPayment は個別会計の支払い 1 回分。一括で払った注文には無い。
//
// 注文の received はお預かりの合計、payment_method は Square の支払いを含めば square になる。
// Square の決済は square_checkouts.order_id で注文に結び付け、どの支払いかは SquareCheckoutID で引く。
type OrderPayment struct {
	ID       uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	OrderID  uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_order_payments_position"`
	Position int       `gorm:"not null;uniqueIndex:idx_order_payments_position"` // 払った順（0 から）
	// "cash" か "square"
	Method   string `gorm:"not null"`
	Amount   int    `gorm:"not null"` // 払った額（明細の値段の合計 − 割引）
	Received int    `gorm:"not null"` // お預かり。Square なら Amount と同じ
	Discount int    `gorm:"not null;default:0"`
	// この支払いで払った明細（order_menus.id）。注文を編集すると明細の ID は残したまま入れ直すので、外した明細だけ消える
	OrderMenuIDs     []uuid.UUID `gorm:"type:jsonb;serializer:json;not null;default:'[]'"`
	SquareCheckoutID *uuid.UUID  `gorm:"type:uuid;uniqueIndex"`
	CreatedAt        time.Time   `gorm:"not null"`
}

func (p *OrderPayment) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	return nil
}
