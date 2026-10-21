package models

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

// CaosClientLog は端末で観測したイベント。再送は (tab_id, sequence) で重複を除く。
// 業務上の成功の記録は CaosOperation（ブラウザのログは失敗・テストプレイも含む）。
type CaosClientLog struct {
	TabID      uuid.UUID       `gorm:"type:uuid;primaryKey" json:"tabId"`
	Sequence   int64           `gorm:"primaryKey;autoIncrement:false" json:"sequence"`
	At         time.Time       `gorm:"not null;index" json:"at"`
	ReceivedAt time.Time       `gorm:"not null" json:"receivedAt"`
	Event      string          `gorm:"type:varchar(128);not null;index" json:"event"`
	Details    json.RawMessage `gorm:"type:jsonb;not null" json:"details"`
}

// CaosOperation は成功した盤面操作。盤面の更新と同じトランザクションで追記する。
// OccurredAt は補正後の押下時刻、RecordedAt はサーバーでの処理時刻。
// 窓のスナップショットはサーバーで適用直前に観測したもの（オフライン中の画面の再現ではない）。
type CaosOperation struct {
	Details         json.RawMessage `gorm:"type:jsonb;serializer:json;not null;default:'{}'" json:"details"`
	ID              uuid.UUID       `gorm:"type:uuid;primaryKey;default:uuid_generate_v4()" json:"id"`
	Kind            string          `gorm:"not null" json:"kind"`
	OccurredAt      time.Time       `gorm:"not null;index" json:"occurred_at"`
	RecordedAt      time.Time       `gorm:"not null;index" json:"recorded_at"`
	ContextAt       time.Time       `gorm:"not null" json:"context_at"`
	ClientPressedAt *int64          `json:"client_pressed_at"`
	ClientSentAt    *int64          `json:"client_sent_at"`
}

// CaosOperationCup は操作時点の1杯（淹れ直しは UnitID で区別、CupID は元のカップ）。
// InWindow は受付済み・ready前・CaOS対象の杯。親と相手の注文は UUID で JOIN できる。
// 注文編集でカップを削除・再作成する既存の仕様に合わせ、現行表への FK は張らない。
// 削除後も操作履歴と当時の注文番号・状態を残す。
type CaosOperationCup struct {
	Added                 bool       `gorm:"not null;default:false" json:"added"`
	Removed               bool       `gorm:"not null;default:false" json:"removed"`
	EmergencyReason       string     `gorm:"not null;default:''" json:"emergency_reason"`
	OperationID           uuid.UUID  `gorm:"type:uuid;primaryKey" json:"operation_id"`
	UnitID                uuid.UUID  `gorm:"type:uuid;primaryKey" json:"unit_id"`
	CupID                 uuid.UUID  `gorm:"type:uuid;not null;index" json:"cup_id"`
	OrderID               uuid.UUID  `gorm:"type:uuid;not null;index" json:"order_id"`
	OrderNo               int        `gorm:"not null" json:"order_no"`
	OrderCreatedAt        time.Time  `gorm:"not null" json:"order_created_at"`
	ReadyAt               *time.Time `json:"ready_at"`
	InWindow              bool       `gorm:"not null" json:"in_window"`
	Changed               bool       `gorm:"not null" json:"changed"`
	AssignedAt            *time.Time `gorm:"index" json:"assigned_at"`
	MergedAt              *time.Time `gorm:"index" json:"merged_at"`
	MergeTargetUnitID     *uuid.UUID `gorm:"type:uuid" json:"merge_target_unit_id"`
	MergeTargetCupID      *uuid.UUID `gorm:"type:uuid;index" json:"merge_target_cup_id"`
	MergeTargetOrderID    *uuid.UUID `gorm:"type:uuid;index" json:"merge_target_order_id"`
	BeforeDripper         *int       `json:"before_dripper"`
	BeforeDripperPosition *int       `json:"before_dripper_position"`
	BeforeDripID          *uuid.UUID `gorm:"type:uuid" json:"before_drip_id"`
	BeforeBrewStartedAt   *time.Time `json:"before_brew_started_at"`
	BeforeBrewFinishedAt  *time.Time `json:"before_brew_finished_at"`
	AfterDripper          *int       `json:"after_dripper"`
	AfterDripperPosition  *int       `json:"after_dripper_position"`
	AfterDripID           *uuid.UUID `gorm:"type:uuid;index" json:"after_drip_id"`
	AfterBrewStartedAt    *time.Time `json:"after_brew_started_at"`
	AfterBrewFinishedAt   *time.Time `json:"after_brew_finished_at"`
}
