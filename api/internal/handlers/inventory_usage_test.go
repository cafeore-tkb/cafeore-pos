package handlers

import (
	"testing"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func TestBuildItemStockUsages(t *testing.T) {
	itemID, cup, bean := uuid.New(), uuid.New(), uuid.New()
	usages, err := buildItemStockUsages(itemID, []models.ItemStockUsageRequest{
		{ResourceId: openapi_types.UUID(cup), Amount: 1},
		{ResourceId: openapi_types.UUID(bean), Amount: 15},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(usages) != 2 || usages[0].ResourceID != cup || usages[1].ItemID != itemID || usages[1].ResourceID != bean || usages[1].Amount != 15 {
		t.Fatalf("incorrect usages: %+v", usages)
	}

	// 空は「使用量を全部消す」なのでエラーにしない
	if usages, err := buildItemStockUsages(itemID, nil); err != nil || len(usages) != 0 {
		t.Fatalf("empty request: %+v %v", usages, err)
	}
}

func TestBuildItemStockUsagesRejectsInvalidRequests(t *testing.T) {
	cup := openapi_types.UUID(uuid.New())
	cases := map[string][]models.ItemStockUsageRequest{
		"zero":      {{ResourceId: cup, Amount: 0}},
		"negative":  {{ResourceId: cup, Amount: -1}},
		"duplicate": {{ResourceId: cup, Amount: 1}, {ResourceId: cup, Amount: 2}},
	}
	for name, req := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := buildItemStockUsages(uuid.New(), req); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
}
