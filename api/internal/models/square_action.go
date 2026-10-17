// api/internal/models/square_action.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// SquareAction は Square Terminal に出した Terminal action の記録。
//
// 今はお客さんが決済手段を選ぶ画面（SELECT）だけを出す。お金は動かないが、
// 端末への依頼は 1 件ずつ順に出るので、出したままの画面があると後から出した
// 決済画面がその後ろに並んでしまう。決済依頼を作る前に、その端末に出したままの
// 画面を取り消せるよう、端末ごとに記録しておく。
//
// Square 側の ID（ActionID）は依頼が通るまで分からないため、先にこちらで行を作る。
type SquareAction struct {
	ID             uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	IdempotencyKey string    `gorm:"not null;uniqueIndex"`
	ActionID       *string   `gorm:"uniqueIndex"` // Square の TerminalAction.id
	DeviceID       string    `gorm:"not null;index"`
	Amount         int       `gorm:"not null"`                                         // 画面に出した額（円）
	Options        []string  `gorm:"type:jsonb;serializer:json;not null;default:'[]'"` // 並べた選択肢（SquareActionOption の値）
	Status         string    `gorm:"not null"`                                         // Square の status。依頼前は CREATING、依頼に失敗したら ERROR
	CancelReason   *string   // Square の cancel_reason
	Selected       *string   // お客さんが選んだ選択肢（Options のどれか）
	ErrorMessage   *string   // 依頼に失敗したときの Square のエラー
	CreatedAt      time.Time `gorm:"not null"`
	UpdatedAt      time.Time `gorm:"not null"`
}

func (action *SquareAction) BeforeCreate(tx *gorm.DB) error {
	if action.ID == uuid.Nil {
		action.ID = uuid.New()
	}
	return nil
}
