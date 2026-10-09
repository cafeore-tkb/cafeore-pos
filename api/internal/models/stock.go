// api/internal/models/stock.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// 在庫を数える対象。カップの種類や豆の銘柄ごとに1行。
type StockResource struct {
	ID   uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	Kind string    `gorm:"not null;check:kind IN ('cup','bean')"`
	Name string    `gorm:"not null"`
	Unit string    `gorm:"not null"`
	// 1杯あたりの量。残量を杯数に換算するのに使う（カップ 1、豆 15）
	PerServing float64 `gorm:"type:double precision;not null;check:per_serving > 0"`
	// 残りが NotifyFrom 杯を切ったら通知し、以降 NotifyStep 杯減るごとに通知する
	NotifyFrom int `gorm:"not null"`
	NotifyStep int `gorm:"not null"`
	// 最低限残したい杯数。これを切ると危険扱い
	Buffer int `gorm:"not null"`
	// 最後に通知した閾値（杯数）。同じ閾値で何度も通知しないために持つ。
	// 残量が戻ったら NULL か上の閾値に戻す。
	LastAlertThreshold *int
	DeletedAt          gorm.DeletedAt `gorm:"index"`
}

func (r *StockResource) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

// アイテム1杯で在庫対象をどれだけ使うか。変えるときは今の行を閉じて新しい行を足し、履歴で持つ。
// 注文は、注文した時刻に有効だった行（ValidFrom 以降、ValidTo より前）で数える。ValidTo が nil なら今有効。
type ItemStockUsage struct {
	ItemID     uuid.UUID `gorm:"type:uuid;primaryKey"`
	ResourceID uuid.UUID `gorm:"type:uuid;primaryKey"`
	ValidFrom  time.Time `gorm:"primaryKey;not null"`
	ValidTo    *time.Time
	Amount     float64 `gorm:"type:double precision;not null;check:amount > 0"`
}

// 棚卸し（count）・入荷（receipt）・調整（adjust）の記録。
// count は実数で残量を置き換え、receipt / adjust は差分として足す。
type StockEvent struct {
	ID         uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	ResourceID uuid.UUID `gorm:"type:uuid;not null;index"`
	Kind       string    `gorm:"not null;check:kind IN ('count','receipt','adjust')"`
	Quantity   float64   `gorm:"type:double precision;not null"`
	Note       string    `gorm:"not null;default:''"`
	CreatedAt  time.Time `gorm:"not null;index"`
}

func (e *StockEvent) BeforeCreate(tx *gorm.DB) error {
	if e.ID == uuid.Nil {
		e.ID = uuid.New()
	}
	return nil
}
