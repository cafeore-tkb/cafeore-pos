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

// CaosLaneChangeRow は担当者の交代の記録（caos_lane_changes）。書くのは handlers/caos_lanes.go だけで、
// 担当者（caos_lanes）を書くのと同じトランザクションで足す（交代で 1 行、入れ替えで 2 行。名前が変わらなくても足す）。
// 抽出の統計で「抽出を始めた時刻に、そのドリッパーにいた人」を出すためのもので、画面には出さず、配信もしない。
type CaosLaneChangeRow struct {
	ID int64 `gorm:"primaryKey"`
	// 替えた時刻（サーバーの時刻。caos_lanes の updated_at と同じ値）
	ChangedAt time.Time `gorm:"not null"`
	// 日本時間の日付（YYYY-MM-DD）。caos_lanes の day と同じ
	Day     string `gorm:"type:date;not null;index"`
	Dripper int    `gorm:"type:smallint;not null;check:caos_lane_changes_dripper_check,dripper BETWEEN 1 AND 6"`
	// 替える前の名前。空なら担当者なし（その日に初めて替えたときも空）
	PrevName string `gorm:"not null"`
	// 替えたあとの名前。空なら担当者なし
	Name string `gorm:"not null"`
	// 替えたあとの人が上級生か（caos_lanes の senior と同じ値）
	Senior bool `gorm:"not null;default:false"`
}

func (CaosLaneChangeRow) TableName() string { return "caos_lane_changes" }
