// api/internal/models/comment.go
package models

import (
	"time"

	"github.com/google/uuid"
)

type Comment struct {
	OrderID   uuid.UUID `gorm:"type:uuid;not null;primary_key"`
	Author    string    `gorm:"not null"`
	Text      string    `gorm:"not null"`
	CreatedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP;primary_key"`
}
