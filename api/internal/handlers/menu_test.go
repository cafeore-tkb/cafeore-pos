package handlers

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestRespondMenuWriteErrorHidesDBErrors(t *testing.T) {
	gin.SetMode(gin.TestMode)
	cases := map[string]struct {
		err      error
		status   int
		contains string
	}{
		"invalid items":         {&invalidMenuItemsError{"duplicate item_id"}, http.StatusBadRequest, "duplicate item_id"},
		"wrapped invalid items": {fmt.Errorf("tx: %w", &invalidMenuItemsError{"item not found"}), http.StatusBadRequest, "item not found"},
		"duplicate key":         {&pgconn.PgError{Code: "23505", ConstraintName: "idx_menus_key"}, http.StatusBadRequest, "key already exists"},
		"db error":              {errors.New(`pq: relation "menu_items" does not exist`), http.StatusInternalServerError, "Internal server error"},
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
			if body := w.Body.String(); !strings.Contains(body, tc.contains) || strings.Contains(body, "menu_items") {
				t.Fatalf("body = %s", body)
			}
		})
	}
}
