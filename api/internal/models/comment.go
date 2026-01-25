// api/internal/models/comment.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type Comment struct {
	ID        uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()" json:"id"`
	OrderID   uuid.UUID `gorm:"type:uuid;not null" json:"order_id"`
	Author    string    `gorm:"not null" json:"author"`
	Text      string    `gorm:"not null" json:"text"`
	CreatedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP" json:"created_at"`
}

func (comment *Comment) BeforeCreate(tx *gorm.DB) error {
	if comment.ID == uuid.Nil {
		comment.ID = uuid.New()
	}
	return nil
}
