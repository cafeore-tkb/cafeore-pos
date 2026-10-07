// api/internal/models/item_type.go
package models

import (
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ItemType struct {
	ID          uuid.UUID      `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	Name        string         `gorm:"not null"`
	DisplayName string         `gorm:"not null"`
	DeletedAt   gorm.DeletedAt `gorm:"index"`

	// この種類のアイテムは1杯ずつカップ（order_cups）を作る。グッズは false。
	// 商品管理で種類ごとに設定する。種類の名前で決め打ちしない。
	//
	// GORM は既定値のある列のゼロ値（false）を INSERT で省いて DB の既定値（true）にしてしまうので、
	// ポインタにしている。読むときは CreatesCup を使う。
	MakesCup *bool `gorm:"not null;default:true"`
	// この種類のアイテムは抽出が要る（割引の対象の杯数・ドリッパーの割り振りに数える）。
	// ミルクやグッズは false。MakesCup が false なら false にする（API で検査する）。
	// 読むときは BrewRequired を使う。
	NeedsBrew *bool `gorm:"not null;default:true"`
	// この種類のアイテムは上級生だけが淹れる（限定）。NeedsBrew が false なら false にする（API で検査する）。
	// 既定値が false なのでゼロ値を省かれても困らず、ポインタにしなくてよい。読むときは SeniorOnlyBrew を使う。
	SeniorOnly bool `gorm:"not null;default:false"`
}

func (item_type *ItemType) BeforeCreate(tx *gorm.DB) error {
	if item_type.ID == uuid.Nil {
		item_type.ID = uuid.New()
	}
	return nil
}

// CreatesCup は MakesCup の値。DB の列は NOT NULL なので、nil は読み込んでいない種類だけで、列の既定値と同じ true とみなす。
func (item_type ItemType) CreatesCup() bool {
	return item_type.MakesCup == nil || *item_type.MakesCup
}

// BrewRequired は NeedsBrew の値。カップを作らない種類は抽出も要らない。
func (item_type ItemType) BrewRequired() bool {
	return item_type.CreatesCup() && (item_type.NeedsBrew == nil || *item_type.NeedsBrew)
}

// SeniorOnlyBrew は SeniorOnly の値。抽出しない種類は限定にもならない。
func (item_type ItemType) SeniorOnlyBrew() bool {
	return item_type.BrewRequired() && item_type.SeniorOnly
}
