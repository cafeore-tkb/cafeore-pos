package models

import "time"

// CaosLaneRow は CaOS の列（ドリッパー 1〜6）の担当者（caos_lanes）の行。営業日ごと。読み書きは handlers/caos_store.go。
// 一度も替えていない列は行が無い（担当者なし）。画面や API に出す形は caos.Lane（配信では 6 列が必ずそろう）。
// 替えるのは CaOS の画面からの操作（set_lane・swap_lanes）だけで、「1つ戻す」で一度も替えていない状態に戻すと行を消す。
type CaosLaneRow struct {
	// 営業日（日本時間の日付）
	Day     string `gorm:"type:date;primaryKey;autoIncrement:false"`
	Dripper int    `gorm:"type:smallint;primaryKey;autoIncrement:false;check:caos_lanes_dripper_check,dripper BETWEEN 1 AND 6"`
	// 担当者の名前。空なら担当者なし
	Name string `gorm:"not null"`
	// 上級生（限定を淹れられる）か。交代したときに画面が sohosai-shift の名簿（seniors）で判定したもの
	Senior bool `gorm:"not null;default:false"`
	// 盤面の時計の値をそのまま入れ、GORM には書き換えさせない
	// （「1つ戻す」は、この値が操作の記録と同じかで、ほかの端末が替えていないかを見る）
	UpdatedAt time.Time `gorm:"not null;autoUpdateTime:false"`
}

func (CaosLaneRow) TableName() string { return "caos_lanes" }
