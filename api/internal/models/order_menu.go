package models

import (
	"time"

	"github.com/google/uuid"
)

// OrderMenu は注文明細。1行が1カップにあたる。
// カップの状態は preparing（ReadyAt, ServedAt とも nil）/ ready（ReadyAt あり）/
// served（ServedAt あり）。served のカップは必ず ReadyAt も持つ。
type OrderMenu struct {
	ID        uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	OrderID   uuid.UUID `gorm:"type:uuid;not null;index"`
	MenuID    uuid.UUID `gorm:"type:uuid;not null;index"`
	Assignee  *string
	MenuName  string `gorm:"not null"`
	UnitPrice int    `gorm:"not null"`
	ReadyAt   *time.Time
	ServedAt  *time.Time

	Menu Menu `gorm:"foreignKey:MenuID;references:ID"`
}
