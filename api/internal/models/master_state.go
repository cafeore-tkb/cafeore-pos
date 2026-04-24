// api/internal/models/master_state.go
package models

import (
	"time"
)

type MasterState struct {
	CreatedAt time.Time `gorm:"not null;default:CURRENT_TIMESTAMP;primary_key"`	
	Type      string    `gorm:"not null"`
}

