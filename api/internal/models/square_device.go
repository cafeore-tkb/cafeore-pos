// api/internal/models/square_device.go
package models

import (
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// SquareDevice はレジから決済画面を出す Square Terminal。
//
// 管理画面で Device Code を発行した時点で行を作り（UNPAIRED）、端末にコードが
// 入力されたら Square から device_id を受け取って PAIRED にする。決済の依頼には
// device_id を使い、レジはどの端末を使うかを device_id で覚える。
//
// 同じ端末をペアリングし直しても device_id は変わらない（Square の開発者
// フォーラムでの回答）。device_id は一意にし、ペアリングし直したら古い行を消す。
//
// 端末がサインアウトしたときは、PAIRED の行にコードを発行し直せる。行は PAIRED の
// まま Code・CodeID・PairBy だけを入れ替え、入力されたら device_id を記録し直す。
//
// Square には API でペアリングを解除する手段が無い。行を消してもレジで
// 選べなくなるだけで、端末は Square にサインインしたまま残る。
type SquareDevice struct {
	ID        uuid.UUID  `gorm:"type:uuid;primary_key;default:uuid_generate_v4()"`
	Name      string     `gorm:"not null"`
	Status    string     `gorm:"not null"`    // SquareDeviceStatus（UNPAIRED / PAIRED / EXPIRED）
	DeviceID  *string    `gorm:"uniqueIndex"` // PAIRED になるまで空
	CodeID    *string    `gorm:"uniqueIndex"` // Square の DeviceCode.id。device_id を直接登録した行は空
	Code      *string    // 端末に入力するコード。入力されるか期限が切れるまでの間だけ
	PairBy    *time.Time // 最後に発行したコードの期限
	CreatedAt time.Time  `gorm:"not null"`
	UpdatedAt time.Time  `gorm:"not null"`
}

func (device *SquareDevice) BeforeCreate(tx *gorm.DB) error {
	if device.ID == uuid.Nil {
		device.ID = uuid.New()
	}
	return nil
}
