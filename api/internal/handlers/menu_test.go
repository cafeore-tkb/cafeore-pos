package handlers

import (
	"testing"

	"cafeore-pos/api/internal/models"
	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"
)

func TestBuildMenuItems(t *testing.T) {
	menuID, hot, ice := uuid.New(), uuid.New(), uuid.New()
	items, err := buildMenuItems(menuID, []models.MenuItemRequest{
		{ItemId: openapi_types.UUID(hot), Quantity: 2},
		{ItemId: openapi_types.UUID(ice), Quantity: 1},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []models.MenuItem{{MenuID: menuID, ItemID: hot, Quantity: 2}, {MenuID: menuID, ItemID: ice, Quantity: 1}}
	if len(items) != len(want) {
		t.Fatalf("items = %+v", items)
	}
	for i := range want {
		if items[i].MenuID != want[i].MenuID || items[i].ItemID != want[i].ItemID || items[i].Quantity != want[i].Quantity {
			t.Errorf("items[%d] = %+v, want %+v", i, items[i], want[i])
		}
	}
}

func TestBuildMenuItemsRejectsInvalidRequests(t *testing.T) {
	item := openapi_types.UUID(uuid.New())
	cases := map[string][]models.MenuItemRequest{
		"no items":       nil,
		"zero quantity":  {{ItemId: item, Quantity: 0}},
		"duplicate item": {{ItemId: item, Quantity: 1}, {ItemId: item, Quantity: 2}},
	}
	for name, requests := range cases {
		if _, err := buildMenuItems(uuid.New(), requests); err == nil {
			t.Errorf("%s: invalid items accepted", name)
		}
	}
}
