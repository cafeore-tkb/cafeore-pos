package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// CaosBrewRecord は開始時の予測と、その後の実績・除外理由。
// drip_id と開始時刻で識別し、開始し直した抽出も前の記録を上書きしない。
type CaosBrewRecord struct {
	DripID               uuid.UUID       `gorm:"type:uuid;primaryKey" json:"drip_id"`
	StartedAt            time.Time       `gorm:"primaryKey" json:"started_at"`
	FinishedAt           *time.Time      `gorm:"index" json:"finished_at"`
	Dripper              int             `json:"dripper"`
	Kind                 string          `json:"kind"`
	UnitIDs              json.RawMessage `gorm:"type:jsonb;not null" json:"unit_ids"`
	Name                 string          `gorm:"not null;default:''" json:"name"`
	Grade                string          `gorm:"not null;default:''" json:"grade"`
	PredictedSeconds     float64         `json:"predicted_seconds"`
	StandardSeconds      float64         `json:"standard_seconds"`
	Coefficient          float64         `json:"coefficient"`
	StandardSamples      int             `json:"standard_samples"`
	PersonSamples        int             `json:"person_samples"`
	ActualSeconds        *float64        `json:"actual_seconds"`
	ExcludedReason       string          `gorm:"not null;default:''" json:"excluded_reason"`
	PersonExcludedReason string          `gorm:"not null;default:''" json:"person_excluded_reason"`
	ModelVersion         string          `json:"model_version"`
	StartOperationID     uuid.UUID       `gorm:"type:uuid" json:"start_operation_id"`
	FinishOperationID    *uuid.UUID      `gorm:"type:uuid" json:"finish_operation_id"`
	RecordedAt           time.Time       `json:"recorded_at"`
	UpdatedAt            time.Time       `json:"updated_at"`
}
