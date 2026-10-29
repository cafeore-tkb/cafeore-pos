package models

import "time"

// DripperAssignee は CaOS（ドリップ管制）のドリッパーの担当者（dripper_assignees）。日本時間の日付ごとに、ドリッパー 1〜6 の 1 行ずつ。
// 読み書きは handlers/caos_lanes.go だけ。替えるのは CaOS の画面の「交代」と「入れ替え」だけで、sohosai-shift の予定で自動では替えない。
// その日にまだ替えていないドリッパーは行が無い（担当者なし）。担当者を空にしたときは行を残して name を空にする。
type DripperAssignee struct {
	// 日本時間の日付（YYYY-MM-DD）
	Day     string `gorm:"type:date;primaryKey;autoIncrement:false"`
	Dripper int    `gorm:"type:smallint;primaryKey;autoIncrement:false;check:dripper_assignees_dripper_check,dripper BETWEEN 1 AND 6"`
	// 担当者の名前。空なら担当者なし
	Name string `gorm:"not null"`
	// Grade はシフト名簿から選んだ場合のみ記録する。空は未確認。
	Grade string `gorm:"not null;default:''"`
	// 上級生か。交代した時点（と、名簿を読み直したとき）に画面が sohosai-shift の名簿（seniors）で判定した値。
	// 名簿を読めない端末でも同じに出て、PUT /api/caos/cups でも確かめられるよう、サーバーに持つ
	Senior    bool      `gorm:"not null;default:false"`
	UpdatedAt time.Time `gorm:"not null"`
}

func (DripperAssignee) TableName() string { return "dripper_assignees" }

// DripperAssigneeChange は担当者の交代の記録（dripper_assignee_changes）。書くのは handlers/caos_lanes.go だけで、
// 担当者（dripper_assignees）を書くのと同じトランザクションで足す（交代で 1 行、入れ替えで 2 行。名前が変わらなくても足す）。
// 抽出の統計で「抽出を始めた時刻に、そのドリッパーにいた人」を出すためのもので、画面には出さず、配信もしない。
type DripperAssigneeChange struct {
	ID int64 `gorm:"primaryKey"`
	// 替えた時刻（サーバーの時刻。dripper_assignees の updated_at と同じ値）
	ChangedAt time.Time `gorm:"not null"`
	// 日本時間の日付（YYYY-MM-DD）。dripper_assignees の day と同じ
	Day     string `gorm:"type:date;not null;index"`
	Dripper int    `gorm:"type:smallint;not null;check:dripper_assignee_changes_dripper_check,dripper BETWEEN 1 AND 6"`
	// 替える前の名前。空なら担当者なし（その日に初めて替えたときも空）
	PrevName string `gorm:"not null"`
	// 替えたあとの名前。空なら担当者なし
	Name  string `gorm:"not null"`
	Grade string `gorm:"not null;default:''"`
	// 替えたあとの人が上級生か（dripper_assignees の senior と同じ値）
	Senior bool `gorm:"not null;default:false"`
}

func (DripperAssigneeChange) TableName() string { return "dripper_assignee_changes" }
