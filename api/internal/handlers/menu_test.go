package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cafeore-pos/api/internal/models"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
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

// 入力の誤りは 400、DB のエラーは 500 で返す
func TestRespondMenuWriteErrorStatus(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := map[string]struct {
		err      error
		status   int
		contains string
	}{
		"invalid items":         {&invalidMenuItemsError{"duplicate item_id"}, http.StatusBadRequest, "duplicate item_id"},
		"wrapped invalid items": {fmt.Errorf("tx: %w", &invalidMenuItemsError{"item not found"}), http.StatusBadRequest, "item not found"},
		"duplicate key":         {&pgconn.PgError{Code: pgUniqueViolation}, http.StatusBadRequest, "key already exists"},
		"db error":              {errors.New(`pq: relation "menu_items" does not exist`), http.StatusInternalServerError, "menu_items"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			w := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(w)
			c.Request = httptest.NewRequest(http.MethodPost, "/menus", nil)
			respondMenuWriteError(c, tc.err)
			if w.Code != tc.status {
				t.Fatalf("status = %d, want %d", w.Code, tc.status)
			}
			if body := w.Body.String(); !strings.Contains(body, tc.contains) {
				t.Fatalf("body = %s", body)
			}
		})
	}
}
