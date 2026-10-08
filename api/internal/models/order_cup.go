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

	// CaOS（ドリップ管制）が決めたこと。読み書きは handlers/caos.go だけで、
	// ほかの画面（レジ・マスター・提供）は読まない（注文の応答にも出さない）。
	// 注文の編集では、ほかの列と同じく同じ値のまま入れ直す。
	//   - DripID：最初に淹れたカード（caos_drips）
	//   - EmergencyAt：緊急（入れ直し）にした時刻
	//   - EmergencyDripID：入れ直しで淹れたカード
	DripID          *uuid.UUID `gorm:"type:uuid;index"`
	EmergencyAt     *time.Time
	EmergencyDripID *uuid.UUID `gorm:"type:uuid;index"`

	Item Item `gorm:"foreignKey:ItemID;references:ID"`
}
