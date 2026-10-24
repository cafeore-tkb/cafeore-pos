package auth

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// トークン文字列をそのまま相手の名前として扱う。"bad" は正しくないトークン。
type stubVerifier struct{}

func (stubVerifier) Header() string { return AccessJWTHeader }

func (stubVerifier) Verify(_ context.Context, token string) (AccessIdentity, error) {
	if token == "" || token == "bad" {
		return AccessIdentity{}, ErrInvalidAccessToken
	}
	return AccessIdentity{Email: token}, nil
}

func TestAuthorizerRequire(t *testing.T) {
	gin.SetMode(gin.TestMode)

	authz := NewAuthorizer(
		stubVerifier{},
		[]string{"Staff@example.com"},
		[]string{"display@example.com", "staff@example.com"},
	)

	r := gin.New()
	r.GET("/read", authz.Require(RoleViewer), func(c *gin.Context) {
		identity, _ := c.Get(IdentityContextKey)
		c.String(http.StatusOK, identity.(AccessIdentity).Email)
	})
	r.POST("/write", authz.Require(RoleStaff), func(c *gin.Context) { c.Status(http.StatusOK) })

	cases := []struct {
		method, path, token string
		want                int
	}{
		{"GET", "/read", "", http.StatusUnauthorized},
		{"GET", "/read", "bad", http.StatusUnauthorized},
		{"GET", "/read", "stranger@example.com", http.StatusForbidden},
		{"GET", "/read", "display@example.com", http.StatusOK},
		{"GET", "/read", "staff@example.com", http.StatusOK},
		{"POST", "/write", "", http.StatusUnauthorized},
		{"POST", "/write", "stranger@example.com", http.StatusForbidden},
		// 表示用の端末は書けない
		{"POST", "/write", "display@example.com", http.StatusForbidden},
		// 両方に書かれていたら強い方。大文字・小文字は区別しない
		{"POST", "/write", "STAFF@example.com", http.StatusOK},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		if tc.token != "" {
			req.Header.Set(AccessJWTHeader, tc.token)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Errorf("%s %s as %q: got %d, want %d", tc.method, tc.path, tc.token, w.Code, tc.want)
		}
	}
}

// @ で始まる項目はドメインごと通す
func TestAuthorizerDomainEntries(t *testing.T) {
	gin.SetMode(gin.TestMode)

	authz := NewAuthorizer(
		stubVerifier{},
		[]string{"@Staff.example.com", "lead@viewer.example.com"},
		[]string{"@viewer.example.com"},
	)

	r := gin.New()
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	r.GET("/read", authz.Require(RoleViewer), ok)
	r.POST("/write", authz.Require(RoleStaff), ok)

	cases := []struct {
		method, path, token string
		want                int
	}{
		{"POST", "/write", "anyone@staff.example.com", http.StatusOK},
		// 大文字・小文字は区別しない
		{"POST", "/write", "Anyone@STAFF.example.com", http.StatusOK},
		{"GET", "/read", "display@viewer.example.com", http.StatusOK},
		{"POST", "/write", "display@viewer.example.com", http.StatusForbidden},
		// ドメインで表示用でも、メールでスタッフに入れた人はスタッフ（強い方）
		{"POST", "/write", "lead@viewer.example.com", http.StatusOK},
		// サブドメインも親のドメインも当たらない
		{"GET", "/read", "someone@sub.staff.example.com", http.StatusForbidden},
		{"GET", "/read", "someone@example.com", http.StatusForbidden},
		// @ の無い名前（サービストークンのクライアント ID）はドメインの項目に当たらない
		{"GET", "/read", "staff.example.com", http.StatusForbidden},
		// 手前が空の名前も当てない
		{"GET", "/read", "@staff.example.com", http.StatusForbidden},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set(AccessJWTHeader, tc.token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Errorf("%s %s as %q: got %d, want %d", tc.method, tc.path, tc.token, w.Code, tc.want)
		}
	}
}

// 検証した回数を数える
type countingVerifier struct {
	stubVerifier
	calls int
}

func (v *countingVerifier) Verify(ctx context.Context, token string) (AccessIdentity, error) {
	v.calls++
	return v.stubVerifier.Verify(ctx, token)
}

// main.go と同じ組み方: /api 全体に RequireByMethod、Square だけさらに RequireStaff
func TestAuthorizerRequireByMethod(t *testing.T) {
	gin.SetMode(gin.TestMode)

	verifier := &countingVerifier{}
	authz := NewAuthorizer(verifier, []string{"staff@example.com"}, []string{"display@example.com"})

	r := gin.New()
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	api := r.Group("/api", authz.RequireByMethod())
	api.GET("/orders", ok)
	api.GET("/ws/orders", ok)
	api.POST("/orders", ok)
	api.PATCH("/orders/1/ready", ok)
	api.DELETE("/orders/1", ok)
	square := api.Group("/square", authz.Require(RoleStaff))
	square.GET("/status", ok)

	cases := []struct {
		method, path, token string
		want                int
	}{
		{"GET", "/api/orders", "", http.StatusUnauthorized},
		{"GET", "/api/orders", "display@example.com", http.StatusOK},
		{"GET", "/api/ws/orders", "display@example.com", http.StatusOK},
		{"POST", "/api/orders", "display@example.com", http.StatusForbidden},
		{"PATCH", "/api/orders/1/ready", "display@example.com", http.StatusForbidden},
		{"DELETE", "/api/orders/1", "display@example.com", http.StatusForbidden},
		{"POST", "/api/orders", "staff@example.com", http.StatusOK},
		// GET でも Square は表示用の端末から読めない
		{"GET", "/api/square/status", "display@example.com", http.StatusForbidden},
		{"GET", "/api/square/status", "staff@example.com", http.StatusOK},
		{"GET", "/api/square/status", "", http.StatusUnauthorized},
	}
	for _, tc := range cases {
		verifier.calls = 0
		req := httptest.NewRequest(tc.method, tc.path, nil)
		if tc.token != "" {
			req.Header.Set(AccessJWTHeader, tc.token)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Errorf("%s %s as %q: got %d, want %d", tc.method, tc.path, tc.token, w.Code, tc.want)
		}
		// 二重に掛けても JWT の検証は 1 回だけ
		if verifier.calls != 1 {
			t.Errorf("%s %s as %q: verified %d times, want 1", tc.method, tc.path, tc.token, verifier.calls)
		}
	}
}

// report-only は弾かずに通し、弾くはずだったものをログに出す
func TestAuthorizerReportOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	authz := NewAuthorizer(stubVerifier{}, []string{"staff@example.com"}, []string{"display@example.com"})
	authz.enforce = false

	r := gin.New()
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	api := r.Group("/api", authz.RequireByMethod())
	api.POST("/orders", ok)
	// 二重に掛けても 1 回だけ出す
	api.POST("/square/checkouts", authz.Require(RoleStaff), ok)

	for _, token := range []string{"", "display@example.com", "staff@example.com"} {
		req := httptest.NewRequest("POST", "/api/orders", nil)
		if token != "" {
			req.Header.Set(AccessJWTHeader, token)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("as %q: got %d, want 200", token, w.Code)
		}
	}

	req := httptest.NewRequest("POST", "/api/square/checkouts", nil)
	req.Header.Set(AccessJWTHeader, "display@example.com")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Errorf("square as display: got %d, want 200", w.Code)
	}

	got := logs.String()
	if n := strings.Count(got, "POST /api/square/checkouts"); n != 1 {
		t.Errorf("square was logged %d times, want 1:\n%s", n, got)
	}
	for _, want := range []string{
		"would reject POST /api/orders with 401",
		`would reject POST /api/orders with 403: "display@example.com" is not allowed`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("log does not contain %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "staff@example.com") {
		t.Errorf("allowed request was logged:\n%s", got)
	}
}

// 管理者はスタッフにできることもでき、RequireStrict(RoleAdmin) は管理者だけを通す
func TestAuthorizerRequireStrict(t *testing.T) {
	gin.SetMode(gin.TestMode)

	authz := NewAuthorizer(stubVerifier{}, []string{"staff@example.com", "@staff.example.com"}, []string{"display@example.com"})
	authz.allow([]string{"Admin@example.com"}, RoleAdmin)

	r := gin.New()
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	api := r.Group("/api", authz.RequireByMethod())
	api.POST("/orders", ok)
	admin := api.Group("/admin", authz.RequireStrict(RoleAdmin))
	admin.GET("/data-reset", ok)
	admin.POST("/data-reset", ok)

	cases := []struct {
		method, path, token string
		want                int
	}{
		{"POST", "/api/orders", "admin@example.com", http.StatusOK},
		{"GET", "/api/admin/data-reset", "admin@example.com", http.StatusOK},
		{"POST", "/api/admin/data-reset", "admin@example.com", http.StatusOK},
		{"GET", "/api/admin/data-reset", "", http.StatusUnauthorized},
		{"GET", "/api/admin/data-reset", "display@example.com", http.StatusForbidden},
		{"GET", "/api/admin/data-reset", "staff@example.com", http.StatusForbidden},
		{"POST", "/api/admin/data-reset", "staff@example.com", http.StatusForbidden},
		// ドメインでスタッフにした相手も管理者ではない
		{"POST", "/api/admin/data-reset", "someone@staff.example.com", http.StatusForbidden},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, tc.path, nil)
		if tc.token != "" {
			req.Header.Set(AccessJWTHeader, tc.token)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Errorf("%s %s as %q: got %d, want %d", tc.method, tc.path, tc.token, w.Code, tc.want)
		}
	}
}

// 認証を掛けていない設定（off と report-only）では、RequireStrict は管理者でも通さない
func TestAuthorizerRequireStrictWithoutEnforcement(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	reportOnly := NewAuthorizer(stubVerifier{}, []string{"staff@example.com"}, nil)
	reportOnly.allow([]string{"admin@example.com"}, RoleAdmin)
	reportOnly.enforce = false

	for name, authz := range map[string]*Authorizer{"off": nil, "report-only": reportOnly} {
		r := gin.New()
		ok := func(c *gin.Context) { c.Status(http.StatusOK) }
		api := r.Group("/api", authz.RequireByMethod())
		api.POST("/admin/data-reset", authz.RequireStrict(RoleAdmin), ok)

		req := httptest.NewRequest("POST", "/api/admin/data-reset", nil)
		req.Header.Set(AccessJWTHeader, "admin@example.com")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s: got %d, want 403", name, w.Code)
		}
		if !strings.Contains(w.Body.String(), AuthDisabledMessage) {
			t.Errorf("%s: body = %s, want the reason", name, w.Body.String())
		}
	}
}

// PR のプレビュー（AUTH_PREVIEW_ADMIN）は、ログインしなくても全部のリクエストが管理者 preview として通る
func TestAuthorizerPreviewAdmin(t *testing.T) {
	gin.SetMode(gin.TestMode)

	authz, err := AuthorizerFromEnv(func(k string) string {
		return map[string]string{"AUTH_PREVIEW_ADMIN": "true"}[k]
	})
	if err != nil {
		t.Fatal(err)
	}
	if !authz.PreviewAdmin() || authz.ReportOnly() {
		t.Fatalf("PreviewAdmin() = %v, ReportOnly() = %v", authz.PreviewAdmin(), authz.ReportOnly())
	}

	r := gin.New()
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	api := r.Group("/api", authz.RequireByMethod())
	api.GET("/me", authz.Me)
	api.POST("/orders", ok)
	api.PUT("/menus/1", authz.Require(RoleAdmin), ok)
	api.POST("/admin/data-reset", authz.RequireStrict(RoleAdmin), ok)

	for _, route := range []string{"POST /api/orders", "PUT /api/menus/1", "POST /api/admin/data-reset"} {
		method, path, _ := strings.Cut(route, " ")
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(method, path, nil))
		if w.Code != http.StatusOK {
			t.Errorf("%s without a token: got %d, want 200", route, w.Code)
		}
	}

	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/api/me", nil))
	if want := `{"email":"preview","enforcement":"enforce","role":"admin"}`; w.Body.String() != want {
		t.Fatalf("got %s, want %s", w.Body.String(), want)
	}
}

func TestAuthorizerNilAllowsAll(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var authz *Authorizer
	r := gin.New()
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	r.POST("/write", authz.Require(RoleStaff), ok)
	r.POST("/api/write", authz.RequireByMethod(), ok)

	for _, path := range []string{"/write", "/api/write"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("POST", path, nil))
		if w.Code != http.StatusOK {
			t.Fatalf("%s: got %d, want 200", path, w.Code)
		}
	}
}

// GET /api/me は、/api のグループで確かめた相手とその権限を返す
func TestAuthorizerMe(t *testing.T) {
	gin.SetMode(gin.TestMode)

	enforced := NewAuthorizer(stubVerifier{}, []string{"staff@example.com"}, []string{"display@example.com"})
	enforced.allow([]string{"admin@example.com"}, RoleAdmin)
	reportOnly := NewAuthorizer(stubVerifier{}, []string{"staff@example.com"}, []string{"display@example.com"})
	reportOnly.enforce = false
	var off *Authorizer

	cases := []struct {
		name   string
		authz  *Authorizer
		token  string
		want   int
		wantMe string
	}{
		{"enforce admin", enforced, "admin@example.com", http.StatusOK,
			`{"email":"admin@example.com","enforcement":"enforce","role":"admin"}`},
		{"enforce staff", enforced, "Staff@example.com", http.StatusOK,
			`{"email":"Staff@example.com","enforcement":"enforce","role":"staff"}`},
		{"enforce viewer", enforced, "display@example.com", http.StatusOK,
			`{"email":"display@example.com","enforcement":"enforce","role":"viewer"}`},
		// 弾く設定なら、権限の無い相手はハンドラーまで来ない
		{"enforce stranger", enforced, "stranger@example.com", http.StatusForbidden, ""},
		{"enforce no token", enforced, "", http.StatusUnauthorized, ""},
		{"report-only stranger", reportOnly, "stranger@example.com", http.StatusOK,
			`{"email":"stranger@example.com","enforcement":"report-only","role":"none"}`},
		{"report-only no token", reportOnly, "", http.StatusOK,
			`{"email":null,"enforcement":"report-only","role":"none"}`},
		{"report-only staff", reportOnly, "staff@example.com", http.StatusOK,
			`{"email":"staff@example.com","enforcement":"report-only","role":"staff"}`},
		{"off", off, "staff@example.com", http.StatusOK,
			`{"email":null,"enforcement":"off","role":null}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := gin.New()
			r.Group("/api", tc.authz.RequireByMethod()).GET("/me", tc.authz.Me)

			req := httptest.NewRequest("GET", "/api/me", nil)
			if tc.token != "" {
				req.Header.Set(AccessJWTHeader, tc.token)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("got %d, want %d", w.Code, tc.want)
			}
			if tc.wantMe != "" && w.Body.String() != tc.wantMe {
				t.Fatalf("got %s, want %s", w.Body.String(), tc.wantMe)
			}
		})
	}
}

func TestAuthorizerFromEnv(t *testing.T) {
	complete := map[string]string{
		"AUTH_MODE":             "cloudflare-access",
		"CF_ACCESS_TEAM_DOMAIN": "cafeore.cloudflareaccess.com",
		"CF_ACCESS_AUD":         "aud-tag",
		"AUTH_STAFF_EMAILS":     "register@example.com, master@example.com",
		"AUTH_VIEWER_EMAILS":    "display@example.com",
	}
	with := func(key, value string) map[string]string {
		m := map[string]string{}
		for k, v := range complete {
			m[k] = v
		}
		m[key] = value
		return m
	}

	cases := map[string]struct {
		env            map[string]string
		wantNil        bool
		wantErr        bool
		wantReportOnly bool
	}{
		"unset":       {env: map[string]string{}, wantNil: true},
		"off":         {env: map[string]string{"AUTH_MODE": "off"}, wantNil: true},
		"complete":    {env: complete},
		"no viewer":   {env: with("AUTH_VIEWER_EMAILS", "")},
		"report-only": {env: with("AUTH_MODE", "cloudflare-access-report-only"), wantReportOnly: true},
		// report-only でも設定の漏れは起動を止める
		"report-only no aud": {env: with("CF_ACCESS_AUD", ""), wantErr: true},
		// 綴りを誤ったら認証が外れるのではなく、起動を止める
		"typo":          {env: with("AUTH_MODE", "cloudflare_access"), wantErr: true},
		"no team":       {env: with("CF_ACCESS_TEAM_DOMAIN", ""), wantErr: true},
		"no aud":        {env: with("CF_ACCESS_AUD", " "), wantErr: true},
		"no staff":      {env: with("AUTH_STAFF_EMAILS", " , "), wantErr: true},
		"broken domain": {env: with("CF_ACCESS_TEAM_DOMAIN", "https://x.cloudflareaccess.com/path"), wantErr: true},
		// 許可リストはドメインごとにも書ける
		"staff domain":  {env: with("AUTH_STAFF_EMAILS", "@id.cafeore.cafe, register@example.com")},
		"viewer domain": {env: with("AUTH_VIEWER_EMAILS", "@ID.cafeore.cafe")},
		// ワイルドカードや崩れたドメインは、黙って誰も通れなくなる前に起動を止める
		"staff wildcard":        {env: with("AUTH_STAFF_EMAILS", "*@example.com"), wantErr: true},
		"viewer star":           {env: with("AUTH_VIEWER_EMAILS", "*"), wantErr: true},
		"bare at":               {env: with("AUTH_STAFF_EMAILS", "@"), wantErr: true},
		"domain without dot":    {env: with("AUTH_STAFF_EMAILS", "@localhost"), wantErr: true},
		"domain with path":      {env: with("AUTH_VIEWER_EMAILS", "@example.com/x"), wantErr: true},
		"space inside an entry": {env: with("AUTH_STAFF_EMAILS", "a b@example.com"), wantErr: true},
		// PR のプレビュー。AUTH_MODE が off（か空）のときだけ。ほかと一緒なら起動を止める（本番の認証が外れないように）
		"preview admin":             {env: map[string]string{"AUTH_PREVIEW_ADMIN": "true"}},
		"preview admin off":         {env: map[string]string{"AUTH_MODE": "off", "AUTH_PREVIEW_ADMIN": "true"}},
		"preview admin false":       {env: map[string]string{"AUTH_PREVIEW_ADMIN": "false"}, wantNil: true},
		"preview admin typo":        {env: map[string]string{"AUTH_PREVIEW_ADMIN": "yes"}, wantErr: true},
		"preview admin with auth":   {env: with("AUTH_PREVIEW_ADMIN", "true"), wantErr: true},
		"preview admin with iap":    {env: map[string]string{"AUTH_MODE": "iap", "IAP_AUDIENCE": "/projects/1/global/backendServices/2", "AUTH_STAFF_EMAILS": "a@example.com", "AUTH_PREVIEW_ADMIN": "true"}, wantErr: true},
		"preview admin with iap-ro": {env: map[string]string{"AUTH_MODE": "iap-report-only", "IAP_AUDIENCE": "/projects/1/global/backendServices/2", "AUTH_STAFF_EMAILS": "a@example.com", "AUTH_PREVIEW_ADMIN": "true"}, wantErr: true},
		// 管理者はアドレスで 1 人ずつ。ドメインごとには書けない
		"admin":          {env: with("AUTH_ADMIN_EMAILS", "lead@example.com")},
		"admin domain":   {env: with("AUTH_ADMIN_EMAILS", "lead@example.com, @example.com"), wantErr: true},
		"admin wildcard": {env: with("AUTH_ADMIN_EMAILS", "*@example.com"), wantErr: true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			authz, err := AuthorizerFromEnv(func(k string) string { return tc.env[k] })
			switch {
			case tc.wantErr:
				if err == nil {
					t.Fatal("want error")
				}
			case err != nil:
				t.Fatalf("unexpected error: %v", err)
			case tc.wantNil != (authz == nil):
				t.Fatalf("authz = %v, wantNil %v", authz, tc.wantNil)
			case authz.ReportOnly() != tc.wantReportOnly:
				t.Fatalf("ReportOnly() = %v, want %v", authz.ReportOnly(), tc.wantReportOnly)
			}
		})
	}

	withAdmins := with("AUTH_ADMIN_EMAILS", "Lead@example.com, master@example.com")
	authz, err := AuthorizerFromEnv(func(k string) string { return withAdmins[k] })
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]Role{
		"register@example.com": RoleStaff,
		// スタッフと管理者の両方に書かれていたら強い方
		"master@example.com":  RoleAdmin,
		"lead@example.com":    RoleAdmin,
		"display@example.com": RoleViewer,
	}
	for name, role := range want {
		if got := authz.roles[name]; got != role {
			t.Errorf("roles[%q] = %d, want %d", name, got, role)
		}
	}
}
