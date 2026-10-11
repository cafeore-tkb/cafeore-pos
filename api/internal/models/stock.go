// api/internal/models/stock.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// 在庫を数える対象。アイテムの在庫（kind item。アイテムごとに 1 つ）とカップ（kind cup）の 2 種類。
type StockResource struct {
	ID   uuid.UUID `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	Kind string    `gorm:"not null;check:kind IN ('item','cup')"`
	// アイテムの在庫ならそのアイテム。カップは nil
	ItemID *uuid.UUID `gorm:"type:uuid;uniqueIndex"`
	// カップの名前。アイテムの在庫はアイテムの名前を使うので空
	Name string `gorm:"not null"`
	Unit string `gorm:"not null"`
	// 1 回で減る量。残量を杯数に換算するのにも使う（豆 15、コースター 1、カップ 1）
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

	Item *Item `gorm:"foreignKey:ItemID"`
	// カップを使うアイテムの種類
	ItemTypes []StockResourceItemType `gorm:"foreignKey:ResourceID"`
}

func (r *StockResource) BeforeCreate(tx *gorm.DB) error {
	if r.ID == uuid.Nil {
		r.ID = uuid.New()
	}
	return nil
}

// アイテムを作ったときに一緒に作る、そのアイテムの在庫。量や通知の段階はあとで在庫対象の更新で変える。
func NewItemStockResource(itemID uuid.UUID) StockResource {
	return StockResource{Kind: string(StockResourceKindItem), ItemID: &itemID, Unit: "個", PerServing: 1}
}

// 画面や通知に出す名前。アイテムの在庫はアイテムの名前。
func (r *StockResource) DisplayName() string {
	if r.Item != nil {
		return r.Item.Name
	}
	return r.Name
}

// カップを使うアイテムの種類。
type StockResourceItemType struct {
	ResourceID uuid.UUID `gorm:"type:uuid;primaryKey"`
	ItemTypeID uuid.UUID `gorm:"type:uuid;primaryKey"`
}

// 注文明細 1 行で在庫対象がどれだけ減るか。注文を受けたときの在庫の設定（per_serving・カップの種類）で決めて残すので、
// あとで設定を変えても前の注文の消費は変わらない。
type OrderStockUsage struct {
	OrderMenuID uuid.UUID `gorm:"type:uuid;primaryKey"`
	ResourceID  uuid.UUID `gorm:"type:uuid;primaryKey;index"`
	OrderID     uuid.UUID `gorm:"type:uuid;not null;index"`
	// 減った回数（売れた数）と量
	Servings int     `gorm:"not null"`
	Amount   float64 `gorm:"type:double precision;not null"`
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
