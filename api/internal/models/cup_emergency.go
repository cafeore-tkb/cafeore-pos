package models

import (
	"time"

	"github.com/google/uuid"
)

// CupEmergency はカップの緊急（入れ直し）1 回（cup_emergencies）。足すのは POST /api/cup-emergencies だけで、同じカップに何度でも足せる。
// カップの列（最初の抽出の記録）は変えず、入れ直しの抽出はこの行の列で持つ。CaOS はこの行を入れ直しのカードとして盤面に出し、
// 割当・移動・統合・「次へ」はカップと同じ決まりで、この行の列を読み書きする（handlers/caos.go。列の意味は OrderCup の同じ名前の列と同じ）。
//
// 注文の編集はカップを消して同じ ID で入れ直すので、order_cups への外部キーは張らない（張ると編集で消えるか、編集が断られる）。
// カップを消すとき（注文の削除・編集で外した明細）は、そのカップの行もいっしょに消す（handlers/order.go）。
type CupEmergency struct {
	ID         uuid.UUID `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()"`
	OrderCupID uuid.UUID `gorm:"type:uuid;not null;index"`
	CreatedAt  time.Time `gorm:"not null"`
	// 入れ直す理由（足したときに書いたもの。無ければ空）
	Reason string `gorm:"not null;default:''"`

	Dripper         *int       `gorm:"type:smallint;check:cup_emergencies_dripper_check,dripper BETWEEN 1 AND 6"`
	DripperPosition *int       `gorm:"type:integer"`
	DripID          *uuid.UUID `gorm:"type:uuid;index"`
	BrewStartedAt   *time.Time
	BrewFinishedAt  *time.Time
	DeliveredAt     *time.Time
}
