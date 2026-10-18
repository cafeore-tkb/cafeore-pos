package handlers

import (
	"encoding/json"
	"time"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// 業務更新と同一トランザクションの成功履歴。画面や本人を推定しない。
// 過去の注文から遡及生成しない。CaOSと同じ保存JSONでレジ・準備・提供を照合できるようにする。
func recordServiceOperation(tx *gorm.DB, kind string, occurred, recorded time.Time, details any) error {
	payload, err := json.Marshal(details)
	if err != nil {
		return err
	}
	operation := models.CaosOperation{
		ID: uuid.New(), Kind: kind, OccurredAt: occurred, RecordedAt: recorded, ContextAt: recorded, Details: payload,
	}
	return tx.Create(&operation).Error
}

type cupStatusEvidence struct {
	CupID        uuid.UUID  `json:"cupId"`
	BeforeReady  *time.Time `json:"beforeReady"`
	AfterReady   *time.Time `json:"afterReady"`
	BeforeServed *time.Time `json:"beforeServed"`
	AfterServed  *time.Time `json:"afterServed"`
}

func changedCupStatuses(before, after *models.Order) []cupStatusEvidence {
	previous := make(map[uuid.UUID]models.OrderCup, len(before.OrderCups))
	for _, cup := range before.OrderCups {
		previous[cup.ID] = cup
	}
	changed := []cupStatusEvidence{}
	for _, cup := range after.OrderCups {
		prev, ok := previous[cup.ID]
		if !ok || (timeEqual(prev.ReadyAt, cup.ReadyAt) && timeEqual(prev.ServedAt, cup.ServedAt)) {
			continue
		}
		changed = append(changed, cupStatusEvidence{cup.ID, prev.ReadyAt, cup.ReadyAt, prev.ServedAt, cup.ServedAt})
	}
	return changed
}
