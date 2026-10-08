package models

import (
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/caos"
)

// CaosDrip は CaOS（ドリップ管制）の保存したカード（caos_drips）。読み書きは handlers/caos.go。
//
// カードの情報だけを持ち、中身（どのカップを淹れるか）は持たない。カップの側が order_cups.drip_id
// でカードを指す。未割当のカードは保存しない（カップから組み立てる）。
// 1 つの列で同時に抽出中は 1 枚だけ（決まりは caos パッケージが守るが、DB でも止める：caos_drips_one_brewing）。
type CaosDrip struct {
	ID uuid.UUID `gorm:"type:uuid;primaryKey"`
	// 営業日（日本時間の日付）
	Day string `gorm:"type:date;not null;index;uniqueIndex:caos_drips_one_brewing,priority:1,where:status = 'brewing'"`
	// 担当の列（1〜6）
	Lane int `gorm:"type:smallint;not null;check:caos_drips_lane_check,lane BETWEEN 1 AND 6;uniqueIndex:caos_drips_one_brewing,priority:2,where:status = 'brewing'"`
	// 列の中の順番（小さいほど先）
	Position float64 `gorm:"type:double precision;not null"`
	// queued：待機 / brewing：抽出中 / done：終了
	Status     caos.Status `gorm:"not null;check:caos_drips_status_check,status IN ('queued', 'brewing', 'done')"`
	StartedAt  *time.Time
	FinishedAt *time.Time
	CreatedAt  time.Time `gorm:"not null"`
}

func (CaosDrip) TableName() string { return "caos_drips" }

// CaosOpRecord は CaOS の画面からの操作の記録（caos_ops）。「1つ戻す」はこの記録で戻す。
// 名前の Record は、openapi から生成した API の型 CaosOp と分けるため。
type CaosOpRecord struct {
	ID   uuid.UUID `gorm:"type:uuid;primaryKey"`
	Day  string    `gorm:"type:date;not null;index"`
	Name string    `gorm:"not null"`
	// 操作の前後のカードとカップ（drip_id・準備完了）
	Change    caos.Change `gorm:"type:jsonb;serializer:json;not null"`
	CreatedAt time.Time   `gorm:"not null"`
	// 戻した時刻。同じ操作は 2 回戻せない
	UndoneAt *time.Time
}

func (CaosOpRecord) TableName() string { return "caos_ops" }
