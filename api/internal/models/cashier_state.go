// api/internal/models/cashier_state.go
package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// CashierStateID は cashier_states に唯一存在する行の ID。
//
// レジは 1 台しか無い前提で、Firestore 時代の global/cashier-state と同じく
// 単一ドキュメントとして扱う。フロント側の globalCashierStateSchema の
// id リテラルと揃えること。
const CashierStateID = "cashier-state"

// JSONB は jsonb カラムに JSON をそのまま出し入れするための型。
//
// json.RawMessage（[]byte）のまま渡すと pgx が bytea として送ってしまい、
// jsonb カラムには入らない。Value で文字列にして渡す。
type JSONB json.RawMessage

func (j JSONB) Value() (driver.Value, error) {
	if len(j) == 0 {
		return nil, nil
	}
	return string(j), nil
}

func (j *JSONB) Scan(value any) error {
	switch v := value.(type) {
	case nil:
		*j = nil
	case []byte:
		*j = append(JSONB{}, v...)
	case string:
		*j = JSONB(v)
	default:
		return fmt.Errorf("unsupported type for JSONB: %T", value)
	}
	return nil
}

func (j JSONB) MarshalJSON() ([]byte, error) {
	if len(j) == 0 {
		return []byte("null"), nil
	}
	return j, nil
}

func (j *JSONB) UnmarshalJSON(data []byte) error {
	if j == nil {
		return errors.New("JSONB: UnmarshalJSON on nil pointer")
	}
	*j = append((*j)[:0], data...)
	return nil
}

// CashierState はレジが今編集している注文と、直前に確定した注文の ID。
//
// cashier-mini（客側の表示）がこれを購読して金額や注文番号を出す。
// 編集中の注文はフロントの orderSchema の JSON をそのまま持つだけで、
// サーバー側では中身を解釈しない（orders テーブルとは無関係の一時状態）。
type CashierState struct {
	ID               string     `gorm:"primary_key;size:64"`
	EdittingOrder    JSONB      `gorm:"type:jsonb;not null"`
	SubmittedOrderID *uuid.UUID `gorm:"type:uuid"`
	UpdatedAt        time.Time  `gorm:"not null"`
}
