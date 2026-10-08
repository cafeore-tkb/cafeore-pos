package models

import (
	"time"

	"github.com/google/uuid"
)

// PrintJobRow は印刷キューの仕事 1 件（print_jobs）。読み書きは handlers/print_job.go。
//
// レジ・マスター・CaOS は積むだけで、プリンターにつないだ端末（「この端末で印刷する」にした端末）が
// 積んだ順（ID の順）に 1 件ずつ取って印刷し、済み・失敗にする。
// シールに何を書くかは持たない。印刷する端末が、取ったときの注文から作る（レジと緊急で同じ作り方）。
type PrintJobRow struct {
	// 積んだ順の番号。印刷はこの順
	ID int64 `gorm:"primaryKey;autoIncrement"`
	// order（注文のラベル）・emergency（「緊急」のシール＋そのカップの本物と同じシール）
	Kind string `gorm:"not null"`
	// cashier（レジ）・master（マスターの緊急ボタン）・caos（CaOS の緊急の入れ直し）
	Source  string    `gorm:"not null"`
	OrderID uuid.UUID `gorm:"type:uuid;not null;index"`
	// 積んだときの注文番号（画面に出す用。注文が消えても残る）
	OrderNo int `gorm:"not null"`
	// emergency の対象のカップ。order では nil
	CupID *uuid.UUID `gorm:"type:uuid"`
	// queued（待ち）・printing（取った）・done（済み）・failed（失敗）・canceled（取り消し）
	Status string `gorm:"not null;index"`
	// 取った端末の ID
	PrinterID  *string
	ClaimedAt  *time.Time
	FinishedAt *time.Time
	// 失敗の理由
	Error *string
	// 取られた回数
	Attempts  int       `gorm:"not null;default:0"`
	CreatedAt time.Time `gorm:"not null"`
	UpdatedAt time.Time `gorm:"not null"`
}

func (PrintJobRow) TableName() string { return "print_jobs" }
