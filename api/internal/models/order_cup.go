package models

import (
	"time"

	"github.com/google/uuid"
)

// OrderCup は注文の1杯。注文明細（メニュー）の構成品のうちグッズ（others）以外を、
// 数量分に展開して注文時に作る。後からメニューの構成が変わっても、作った時点の
// item を指したまま変わらない。
//
// 状態は preparing（ReadyAt, ServedAt とも nil）/ ready（ReadyAt あり）/
// served（ServedAt あり）。served のカップは必ず ReadyAt も持つ。
type OrderCup struct {
	ID          uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	OrderID     uuid.UUID `gorm:"type:uuid;not null;index"`
	OrderMenuID uuid.UUID `gorm:"type:uuid;not null;index"`
	ItemID      uuid.UUID `gorm:"type:uuid;not null"`
	// 注文内での並び順（0 始まり）
	Position int `gorm:"not null"`
	ReadyAt  *time.Time
	ServedAt *time.Time

	Item Item `gorm:"foreignKey:ItemID;references:ID"`
}
