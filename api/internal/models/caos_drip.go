package models

import (
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/caos"
)

// CaosDripRow は CaOS の抽出カード（caos_drips）の行。読み書きは handlers/caos_store.go。
// 画面や API に出す形は caos.Drip（order_ids と杯数は明細の lines から求めるので、表には持たない）。
// 名前の Row は、openapi から生成した API の型 CaosDrip と分けるため。
//
// 1 人のドリッパーが同時に抽出できるのは 1 枚だけ（caos の決まりが守っているが、念のため DB でも止める：caos_drips_one_brewing）。
type CaosDripRow struct {
	ID uuid.UUID `gorm:"type:uuid;primaryKey"`
	// 営業日（日本時間の日付）
	Day string `gorm:"type:date;not null;index;uniqueIndex:caos_drips_one_brewing,priority:1,where:status = 'brewing'"`
	// unassigned：未割当 / queued：担当の待機列 / brewing：抽出中 / done：抽出終了
	Status caos.Status `gorm:"not null;check:caos_drips_status_check,status IN ('unassigned', 'queued', 'brewing', 'done')"`
	// 担当のドリッパー（1〜6）
	Dripper     *int            `gorm:"type:smallint;check:caos_drips_dripper_check,dripper BETWEEN 1 AND 6;uniqueIndex:caos_drips_one_brewing,priority:2,where:status = 'brewing'"`
	QueuePos    float64         `gorm:"type:double precision;not null"`
	Lines       []caos.DripLine `gorm:"type:jsonb;serializer:json;not null"`
	RebrewOf    *uuid.UUID      `gorm:"type:uuid"`
	Interrupted bool            `gorm:"not null;default:false"`
	StartedAt   *time.Time
	FinishedAt  *time.Time
	CreatedAt   time.Time `gorm:"not null"`
	// 盤面の時計の値をそのまま入れ、GORM には書き換えさせない
	// （「1つ戻す」は、この値が操作の記録と同じかで、ほかの端末が触っていないかを見る）
	UpdatedAt time.Time `gorm:"not null;autoUpdateTime:false"`
}

func (CaosDripRow) TableName() string { return "caos_drips" }
