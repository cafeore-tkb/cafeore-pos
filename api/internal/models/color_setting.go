// api/internal/models/color_setting.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// ColorSetting はマスター・提供画面でのアイテムの背景色設定。
//
// 画面ごとに1行持つ。同じ対象・同じ画面に2つの色が付かないよう、
// (target_type, target_id, screen) に一意制約を張っている。
// 論理削除にすると一意制約とぶつかるので、設定解除は物理削除にする。
type ColorSetting struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	TargetType string    `gorm:"not null;uniqueIndex:idx_color_settings_target_screen"` // "Item" または "ItemType"
	TargetID   uuid.UUID `gorm:"type:uuid;not null;uniqueIndex:idx_color_settings_target_screen"`
	Screen     string    `gorm:"not null;uniqueIndex:idx_color_settings_target_screen"` // "master" または "serve"
	Color      string    `gorm:"not null"`                                              // #RRGGBB
	CreatedAt  time.Time `gorm:"not null"`
	UpdatedAt  time.Time `gorm:"not null"`
}

func (colorSetting *ColorSetting) BeforeCreate(tx *gorm.DB) error {
	if colorSetting.ID == uuid.Nil {
		colorSetting.ID = uuid.New()
	}
	return nil
}
