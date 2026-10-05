// api/internal/models/square_checkout.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// SquareCheckout は Square Terminal に出した決済依頼（Terminal checkout）の記録。
//
// 決済が先・注文が後の順で処理するので、決済が完了した時点ではまだ注文が無い。
// 注文を作ったときに OrderID を埋める。OrderID が空のまま COMPLETED になって
// いる行は「お金は受け取ったが注文が無い」状態なので、照合の対象になる。
//
// Square 側の ID（CheckoutID）は依頼が通るまで分からないため、先にこちらで
// 行を作り、その ID を reference_id として Square に渡す。応答が失われても
// Webhook の reference_id から行を引ける。
type SquareCheckout struct {
	ID             uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	IdempotencyKey string     `gorm:"not null;uniqueIndex"`
	CheckoutID     *string    `gorm:"uniqueIndex"` // Square の TerminalCheckout.id
	DeviceID       string     `gorm:"not null"`
	Amount         int        `gorm:"not null"` // 円
	PaymentType    string     `gorm:"not null"`
	Status         string     `gorm:"not null"` // Square の status。依頼前は CREATING、依頼に失敗したら ERROR
	CancelReason   *string    // Square の cancel_reason
	PaymentIDs     []string   `gorm:"type:jsonb;serializer:json;not null;default:'[]'"`
	PaidAmount     *int       // 完了後に Payments API で確かめた受取額（円）
	ErrorMessage   *string    // 依頼や確認に失敗したときの Square のエラー
	OrderNumber    *int       // 依頼時点の注文番号（表示用。注文と結び付けるのは OrderID）
	OrderID        *uuid.UUID `gorm:"type:uuid;uniqueIndex"`
	CreatedAt      time.Time  `gorm:"not null"`
	UpdatedAt      time.Time  `gorm:"not null"`
}

func (checkout *SquareCheckout) BeforeCreate(tx *gorm.DB) error {
	if checkout.ID == uuid.Nil {
		checkout.ID = uuid.New()
	}
	return nil
}
