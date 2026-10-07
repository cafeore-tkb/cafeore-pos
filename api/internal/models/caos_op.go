package models

import (
	"time"

	"github.com/google/uuid"

	"cafeore-pos/api/internal/caos"
)

// CaosOpRow は CaOS の画面からの操作の記録（caos_ops）。読み書きは handlers/caos_store.go。
// 「1つ戻す」は、画面から送られた中身ではなく、この記録（サーバーが DB から取ったもの）で戻す。
type CaosOpRow struct {
	ID   uuid.UUID `gorm:"type:uuid;primaryKey"`
	Day  string    `gorm:"type:date;not null;index"`
	Name string    `gorm:"not null"`
	// 操作で変わった・消えたカードの、操作の前の中身
	Before []caos.Drip `gorm:"type:jsonb;serializer:json;not null"`
	// 操作で変わった・できたカードの、操作の後の中身（戻すときに、これから誰も触っていないかを updated_at で確かめる）
	After []caos.Drip `gorm:"type:jsonb;serializer:json;not null"`
	// 操作で準備完了にした注文と、そのとき付けた ready_at（戻すときに、これから変わっていないかを確かめる）
	Readied   []caos.ReadyMark `gorm:"type:jsonb;serializer:json;not null"`
	CreatedAt time.Time        `gorm:"not null"`
	// 戻した時刻。同じ操作は 2 回戻せない
	UndoneAt *time.Time
}

func (CaosOpRow) TableName() string { return "caos_ops" }
