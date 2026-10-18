package models

import (
	"time"

	"github.com/google/uuid"
)

// LabelPrintRequest は、端末（CaOS・マスターの緊急）がラベル用のプリンターに直接刷れなかったシールを、
// 代理印刷をオンにしたレジに刷ってもらう頼み（label_print_requests）。足すのは POST /api/label-print-requests だけ。
//
// 刷るのは引き受けた（claim した）レジだけで、引き受けは ClaimedUntil で切れる（刷っている途中にレジを閉じても、ほかのレジが引き受け直せる）。
// 刷れたら PrintedAt を付け、行は残す（同じ id を送り直されても 2 枚刷らない）。
// 緊急のシールは ID が入れ直しの ID で、緊急を取り消すと行も消す（handlers/cup_emergency.go）。
type LabelPrintRequest struct {
	// 入れ直しの ID（入れ直しがあるときだけ足せる）
	ID uuid.UUID `gorm:"type:uuid;primaryKey"`
	// 印刷データ（画面の PrintJob の JSON）。サーバーは中身を解釈しない
	Job       JSONB     `gorm:"type:jsonb;not null"`
	CreatedAt time.Time `gorm:"not null;index"`
	// 引き受けたレジ（ページを開くたびに画面が作る id）と、引き受けが切れる時刻。引き受けていなければどちらも nil
	ClaimedBy    *string `gorm:"size:64"`
	ClaimedUntil *time.Time
	// 刷れた時刻と、刷ったレジ
	PrintedAt *time.Time
	PrintedBy *string `gorm:"size:64"`
}
