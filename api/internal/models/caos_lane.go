package models

import "time"

// CaosLaneRow は CaOS（ドリップ管制）のドリッパーの担当者（caos_lanes）。日本時間の日付ごとに、ドリッパー 1〜6 の 1 行ずつ。
// 読み書きは handlers/caos_lanes.go だけ。替えるのは CaOS の画面の「交代」と「入れ替え」だけで、sohosai-shift の予定で自動では替えない。
// その日にまだ替えていないドリッパーは行が無い（担当者なし）。担当者を空にしたときは行を残して name を空にする。
type CaosLaneRow struct {
	// 日本時間の日付（YYYY-MM-DD）
	Day     string `gorm:"type:date;primaryKey;autoIncrement:false"`
	Dripper int    `gorm:"type:smallint;primaryKey;autoIncrement:false;check:caos_lanes_dripper_check,dripper BETWEEN 1 AND 6"`
	// 担当者の名前。空なら担当者なし
	Name string `gorm:"not null"`
	// 上級生（限定を淹れられる）か。交代した時点で画面が sohosai-shift の名簿（seniors）で判定した値。
	// 名簿を読めない端末でも同じに出て、PUT /api/caos/cups でも確かめられるよう、サーバーに持つ
	Senior    bool      `gorm:"not null;default:false"`
	UpdatedAt time.Time `gorm:"not null"`
}

func (CaosLaneRow) TableName() string { return "caos_lanes" }
