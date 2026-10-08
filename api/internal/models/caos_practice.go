package models

import (
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/caos"
)

// CaosPracticeRow は CaOS の練習用の盤面（実データテスト）の 1 回分（caos_practices）。読み書きは handlers/caos_practice_store.go。
// 盤面の全部（練習の注文・カード・列の担当者・操作の記録）を 1 行の jsonb に持つ（決まりは caos.PracticeDoc）。
// 本番の盤面（caos_drips・caos_lanes・caos_ops）と注文（orders）には触らない。
type CaosPracticeRow struct {
	ID    uuid.UUID        `gorm:"type:uuid;primaryKey"`
	State caos.PracticeDoc `gorm:"type:jsonb;serializer:json;not null"`
	// 作った時刻・最後に変えた時刻（本当の時刻。練習の時計ではない。片付けに使う）
	CreatedAt time.Time `gorm:"not null;autoCreateTime:false"`
	UpdatedAt time.Time `gorm:"not null;index;autoUpdateTime:false"`
}

func (CaosPracticeRow) TableName() string { return "caos_practices" }
