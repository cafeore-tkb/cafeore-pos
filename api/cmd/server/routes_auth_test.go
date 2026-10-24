package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"cafeore-pos/api/internal/auth"
	"cafeore-pos/api/internal/handlers"

	"github.com/gin-gonic/gin"
)

// トークン文字列をそのまま相手のメールとして扱う。空は正しくないトークン。
type stubVerifier struct{}

func (stubVerifier) Header() string { return auth.AccessJWTHeader }

func (stubVerifier) Verify(_ context.Context, token string) (auth.AccessIdentity, error) {
	if token == "" {
		return auth.AccessIdentity{}, auth.ErrInvalidAccessToken
	}
	return auth.AccessIdentity{Email: token}, nil
}

// 「運営・管理」と「マスタ設定」の画面だけが使う書き込みは管理者だけ。
// 営業中の画面（レジ・マスター・CaOS など）も使うものはスタッフのまま。
func TestRegisterRoutesAdminOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)
	authz := auth.NewAuthorizer(stubVerifier{}, []string{"staff@example.com"}, []string{"display@example.com"}, "admin@example.com")
	r := gin.New()
	// ハンドラーは DB などが nil のままなので、権限を通ると落ちる（500 になる）。見るのは 401・403 かどうかだけ
	r.Use(gin.RecoveryWithWriter(io.Discard))
	handlers.RegisterRoutes(r, authz, nil, nil, nil, nil, nil)

	const id = "00000000-0000-0000-0000-000000000001"
	adminOnly := []string{
		"POST /api/items", "PUT /api/items/" + id, "DELETE /api/items/" + id,
		"POST /api/menus", "PUT /api/menus/" + id, "DELETE /api/menus/" + id,
		"POST /api/item-types", "PUT /api/item-types/" + id, "DELETE /api/item-types/" + id,
		"PUT /api/color-settings", "DELETE /api/color-settings/" + id,
		"POST /api/inventory/resources", "PUT /api/inventory/resources/" + id, "DELETE /api/inventory/resources/" + id,
		"PUT /api/printer-settings",
		"POST /api/square/devices", "POST /api/square/devices/pair", "POST /api/square/devices/import",
		"POST /api/square/devices/" + id + "/code", "DELETE /api/square/devices/" + id,
	}
	// 営業中の画面も使うので、スタッフが使えるままのもの
	staff := []string{
		"GET /api/menus", "GET /api/items", "GET /api/item-types", "GET /api/color-settings",
		"GET /api/inventory", "GET /api/printer-settings", "GET /api/master-status",
		"GET /api/square/status", "GET /api/square/devices",
		// 棚卸し・入荷の記録は CaOS の「豆残量確認」からもする
		"POST /api/inventory/resources/" + id + "/events",
		"POST /api/orders", "POST /api/master-status",
	}

	status := func(route, token string) int {
		method, path, _ := strings.Cut(route, " ")
		req := httptest.NewRequest(method, path, strings.NewReader("{}"))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set(auth.AccessJWTHeader, token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}
	denied := func(code int) bool { return code == http.StatusUnauthorized || code == http.StatusForbidden }

	for _, route := range adminOnly {
		if got := status(route, "staff@example.com"); got != http.StatusForbidden {
			t.Errorf("%s as staff: got %d, want 403", route, got)
		}
		if got := status(route, "admin@example.com"); denied(got) {
			t.Errorf("%s as admin: got %d, want it to pass the auth", route, got)
		}
	}
	for _, route := range staff {
		if got := status(route, "staff@example.com"); denied(got) {
			t.Errorf("%s as staff: got %d, want it to pass the auth", route, got)
		}
	}
}
