package auth

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// header のトークン文字列をそのまま相手の名前として扱う。"bad" は正しくないトークン。
type stubVerifier struct{ header string }

func (s stubVerifier) Header() string {
	return s.header
}

func (stubVerifier) Verify(_ context.Context, token string) (AccessIdentity, error) {
	if token == "" || token == "bad" {
		return AccessIdentity{}, ErrInvalidAccessToken
	}
	return AccessIdentity{Email: token}, nil
}

func mustNewAuthorizer(t *testing.T, staff, viewers []string, verifiers ...identityVerifier) *Authorizer {
	t.Helper()

	authz, err := NewAuthorizer(staff, viewers, verifiers...)
	if err != nil {
		t.Fatal(err)
	}
	return authz
}

func TestAuthorizerRequire(t *testing.T) {
	gin.SetMode(gin.TestMode)

	authz := mustNewAuthorizer(
		t,
		[]string{"Staff@example.com"},
		[]string{"display@example.com", "staff@example.com"},
		stubVerifier{AccessJWTHeader},
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

	verifier := &countingVerifier{stubVerifier: stubVerifier{AccessJWTHeader}}
	authz := mustNewAuthorizer(t, []string{"staff@example.com"}, []string{"display@example.com"}, verifier)

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
		// 二重に掛けても JWT の検証は 1 回だけ。ヘッダーが無ければ検証しない
		wantCalls := 1
		if tc.token == "" {
			wantCalls = 0
		}
		if verifier.calls != wantCalls {
			t.Errorf("%s %s as %q: verified %d times, want %d", tc.method, tc.path, tc.token, verifier.calls, wantCalls)
		}
	}
}

// report-only は弾かずに通し、弾くはずだったものをログに出す
func TestAuthorizerReportOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	authz := mustNewAuthorizer(t, []string{"staff@example.com"}, []string{"display@example.com"}, stubVerifier{AccessJWTHeader})
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

// 2 つの方式を並べたとき（cloudflare-access+iap）。ふつうはどちらか 1 つのヘッダーだけが付く
func TestAuthorizerMultipleVerifiers(t *testing.T) {
	gin.SetMode(gin.TestMode)

	authz := mustNewAuthorizer(
		t,
		[]string{"staff@example.com"},
		[]string{"display@example.com"},
		stubVerifier{AccessJWTHeader},
		stubVerifier{IAPJWTHeader},
	)

	r := gin.New()
	ok := func(c *gin.Context) {
		identity, _ := c.Get(IdentityContextKey)
		c.String(http.StatusOK, identity.(AccessIdentity).Email)
	}
	api := r.Group("/api", authz.RequireByMethod())
	api.GET("/orders", ok)
	api.POST("/orders", ok)

	cases := map[string]struct {
		method string
		access []string // Cf-Access-Jwt-Assertion に入れる値（nil なら付けない）
		iap    []string // X-Goog-Iap-Jwt-Assertion に入れる値（nil なら付けない）
		want   int
		// 通ったときに相手として置かれるメール
		wantIdentity string
	}{
		"none":                    {method: "POST", want: http.StatusUnauthorized},
		"access only":             {method: "POST", access: []string{"staff@example.com"}, want: http.StatusOK, wantIdentity: "staff@example.com"},
		"iap only":                {method: "POST", iap: []string{"staff@example.com"}, want: http.StatusOK, wantIdentity: "staff@example.com"},
		"access bad":              {method: "GET", access: []string{"bad"}, want: http.StatusUnauthorized},
		"iap bad":                 {method: "GET", iap: []string{"bad"}, want: http.StatusUnauthorized},
		"iap empty":               {method: "GET", iap: []string{""}, want: http.StatusUnauthorized},
		"iap viewer can read":     {method: "GET", iap: []string{"display@example.com"}, want: http.StatusOK, wantIdentity: "display@example.com"},
		"iap viewer cannot write": {method: "POST", iap: []string{"display@example.com"}, want: http.StatusForbidden},
		"iap stranger":            {method: "GET", iap: []string{"stranger@example.com"}, want: http.StatusForbidden},
		// 両方付いていたら両方を確かめる。片方が正しくても、もう片方が正しくなければ通さない
		"both ok":             {method: "POST", access: []string{"staff@example.com"}, iap: []string{"staff@example.com"}, want: http.StatusOK, wantIdentity: "staff@example.com"},
		"access ok iap bad":   {method: "GET", access: []string{"staff@example.com"}, iap: []string{"bad"}, want: http.StatusUnauthorized},
		"access bad iap ok":   {method: "GET", access: []string{"bad"}, iap: []string{"staff@example.com"}, want: http.StatusUnauthorized},
		"access ok iap empty": {method: "GET", access: []string{"staff@example.com"}, iap: []string{""}, want: http.StatusUnauthorized},
		// 両方正しければ弱い方の権限で見る
		"staff and viewer read":  {method: "GET", access: []string{"staff@example.com"}, iap: []string{"display@example.com"}, want: http.StatusOK, wantIdentity: "display@example.com"},
		"staff and viewer write": {method: "POST", access: []string{"staff@example.com"}, iap: []string{"display@example.com"}, want: http.StatusForbidden},
		"viewer and staff write": {method: "POST", access: []string{"display@example.com"}, iap: []string{"staff@example.com"}, want: http.StatusForbidden},
		"staff and stranger":     {method: "GET", access: []string{"stranger@example.com"}, iap: []string{"staff@example.com"}, want: http.StatusForbidden},
		// 同じヘッダーが 2 つ付いていたら、どれを信じるか決められないので通さない
		"iap twice":    {method: "GET", iap: []string{"staff@example.com", "staff@example.com"}, want: http.StatusUnauthorized},
		"access twice": {method: "GET", access: []string{"bad", "staff@example.com"}, want: http.StatusUnauthorized},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest(tc.method, "/api/orders", nil)
			for _, v := range tc.access {
				req.Header.Add(AccessJWTHeader, v)
			}
			for _, v := range tc.iap {
				req.Header.Add(IAPJWTHeader, v)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("got %d, want %d", w.Code, tc.want)
			}
			if tc.wantIdentity != "" && w.Body.String() != tc.wantIdentity {
				t.Fatalf("identity = %q, want %q", w.Body.String(), tc.wantIdentity)
			}
		})
	}
}

// AUTH_MODE に無い方式のヘッダーは見ない（取り違えても通らない）
func TestAuthorizerIgnoresOtherHeaders(t *testing.T) {
	gin.SetMode(gin.TestMode)

	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	cases := map[string]struct {
		verifier stubVerifier
		header   string
		want     int
	}{
		"iap mode with iap":       {stubVerifier{IAPJWTHeader}, IAPJWTHeader, http.StatusOK},
		"iap mode with access":    {stubVerifier{IAPJWTHeader}, AccessJWTHeader, http.StatusUnauthorized},
		"access mode with access": {stubVerifier{AccessJWTHeader}, AccessJWTHeader, http.StatusOK},
		"access mode with iap":    {stubVerifier{AccessJWTHeader}, IAPJWTHeader, http.StatusUnauthorized},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			authz := mustNewAuthorizer(t, []string{"staff@example.com"}, nil, tc.verifier)
			r := gin.New()
			r.POST("/api/orders", authz.RequireByMethod(), ok)

			req := httptest.NewRequest("POST", "/api/orders", nil)
			req.Header.Set(tc.header, "staff@example.com")
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("got %d, want %d", w.Code, tc.want)
			}
		})
	}
}

// report-only は並べた方式の全部に掛かる。弾くはずだった理由にヘッダーの名前が出る
func TestAuthorizerReportOnlyMultipleVerifiers(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	authz := mustNewAuthorizer(
		t,
		[]string{"staff@example.com"},
		nil,
		stubVerifier{AccessJWTHeader},
		stubVerifier{IAPJWTHeader},
	)
	authz.enforce = false

	r := gin.New()
	r.POST("/api/orders", authz.RequireByMethod(), func(c *gin.Context) { c.Status(http.StatusOK) })

	for _, header := range []string{"", AccessJWTHeader, IAPJWTHeader} {
		req := httptest.NewRequest("POST", "/api/orders", nil)
		if header != "" {
			req.Header.Set(header, "bad")
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusOK {
			t.Errorf("with %q: got %d, want 200", header, w.Code)
		}
	}

	// スタブはどちらのヘッダーでも ErrInvalidAccessToken を返す
	got := logs.String()
	for _, want := range []string{
		"would reject POST /api/orders with 401: no token in Cf-Access-Jwt-Assertion or X-Goog-Iap-Jwt-Assertion",
		"would reject POST /api/orders with 401: Cf-Access-Jwt-Assertion: invalid access token",
		"would reject POST /api/orders with 401: X-Goog-Iap-Jwt-Assertion: invalid access token",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("log does not contain %q:\n%s", want, got)
		}
	}
}

// *@<ドメイン> で、そのドメインのメールの全員に権限を与える。名指しの行が優先する
func TestAuthorizerDomainRoles(t *testing.T) {
	authz := mustNewAuthorizer(
		t,
		[]string{"*@id.cafeore.cafe", "register@example.com", "both@id.cafeore.cafe"},
		[]string{"callscreen@id.cafeore.cafe", "*@viewer.example.com", "*@ID.Cafeore.Cafe", "both@id.cafeore.cafe"},
	)

	cases := map[string]struct {
		identity AccessIdentity
		want     Role
	}{
		"domain":                {AccessIdentity{Email: "someone@id.cafeore.cafe"}, RoleStaff},
		"domain upper case":     {AccessIdentity{Email: "Someone@ID.CAFEORE.CAFE"}, RoleStaff},
		"named":                 {AccessIdentity{Email: "register@example.com"}, RoleStaff},
		"other in named domain": {AccessIdentity{Email: "someone@example.com"}, RoleNone},
		"viewer domain":         {AccessIdentity{Email: "display@viewer.example.com"}, RoleViewer},
		// 名指しの行（表示用）がドメインの行（スタッフ）より優先する
		"named beats domain":            {AccessIdentity{Email: "callscreen@id.cafeore.cafe"}, RoleViewer},
		"named beats domain upper case": {AccessIdentity{Email: "CallScreen@Id.Cafeore.Cafe"}, RoleViewer},
		// 名指しの行が両方の一覧にあれば強い方
		"named in both": {AccessIdentity{Email: "both@id.cafeore.cafe"}, RoleStaff},
		// サブドメインや、後ろだけが同じドメインは一致しない
		"subdomain":     {AccessIdentity{Email: "foo@x.id.cafeore.cafe"}, RoleNone},
		"suffix only":   {AccessIdentity{Email: "foo@evilid.cafeore.cafe"}, RoleNone},
		"parent domain": {AccessIdentity{Email: "foo@cafeore.cafe"}, RoleNone},
		"longer domain": {AccessIdentity{Email: "foo@id.cafeore.cafe.evil.com"}, RoleNone},
		"no at":         {AccessIdentity{Email: "id.cafeore.cafe"}, RoleNone},
		"at in local":   {AccessIdentity{Email: `"a@b"@id.cafeore.cafe`}, RoleStaff},
		"empty":         {AccessIdentity{}, RoleNone},
		// サービストークンのクライアント ID にはドメインを効かせない
		"common name": {AccessIdentity{CommonName: "client@id.cafeore.cafe"}, RoleNone},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			if got := authz.role(tc.identity); got != tc.want {
				t.Fatalf("role(%+v) = %d, want %d", tc.identity, got, tc.want)
			}
		})
	}

	// ドメインの行が両方の一覧にあれば強い方
	both := mustNewAuthorizer(t, []string{"*@id.cafeore.cafe"}, []string{"*@id.cafeore.cafe"})
	if got := both.role(AccessIdentity{Email: "a@id.cafeore.cafe"}); got != RoleStaff {
		t.Errorf("domain in both: role = %d, want %d", got, RoleStaff)
	}
	// 名指しのサービストークンは今までどおり通る
	token := mustNewAuthorizer(t, []string{"*@id.cafeore.cafe"}, []string{"client-id.access"})
	if got := token.role(AccessIdentity{CommonName: "client-id.access"}); got != RoleViewer {
		t.Errorf("named common name: role = %d, want %d", got, RoleViewer)
	}
}

// main.go と同じ組み方で、ドメインの行が効くこと
func TestAuthorizerDomainRequireByMethod(t *testing.T) {
	gin.SetMode(gin.TestMode)

	authz := mustNewAuthorizer(
		t,
		[]string{"*@id.cafeore.cafe"},
		[]string{"callscreen@id.cafeore.cafe"},
		stubVerifier{IAPJWTHeader},
	)
	r := gin.New()
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	api := r.Group("/api", authz.RequireByMethod())
	api.GET("/orders", ok)
	api.POST("/orders", ok)

	cases := []struct {
		method, token string
		want          int
	}{
		{"POST", "someone@id.cafeore.cafe", http.StatusOK},
		{"GET", "callscreen@id.cafeore.cafe", http.StatusOK},
		{"POST", "callscreen@id.cafeore.cafe", http.StatusForbidden},
		{"GET", "foo@x.id.cafeore.cafe", http.StatusForbidden},
		{"GET", "someone@gmail.com", http.StatusForbidden},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, "/api/orders", nil)
		req.Header.Set(IAPJWTHeader, tc.token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Errorf("%s as %q: got %d, want %d", tc.method, tc.token, w.Code, tc.want)
		}
	}
}

// * を含むのに *@<ドメイン> の形でない要素は、起動を止める
func TestNewAuthorizerInvalidDomain(t *testing.T) {
	for _, entry := range []string{
		"*",
		"*@",
		"*foo@id.cafeore.cafe",
		"foo*@id.cafeore.cafe",
		"*@*.id.cafeore.cafe",
		"*@id.*.cafe",
		"*@id.cafeore.cafe*",
		"**@id.cafeore.cafe",
		"*@id@cafeore.cafe",
		"*@id cafeore.cafe",
		"*@id\tcafeore.cafe",
		"*@ id.cafeore.cafe",
		"*@.id.cafeore.cafe",
		"*@id.cafeore.cafe.",
		"*@id..cafeore.cafe",
		"*@id.cafeore.cafe/",
		"@*id.cafeore.cafe",
		"foo@*",
	} {
		for _, lists := range [][2][]string{
			{{entry}, nil},
			{{"staff@example.com"}, {entry}},
		} {
			if _, err := NewAuthorizer(lists[0], lists[1]); err == nil {
				t.Errorf("NewAuthorizer(%q, %q): want error", lists[0], lists[1])
			}
		}
	}

	// 前後の空白と大文字は書き方の誤りにしない
	for _, entry := range []string{"*@id.cafeore.cafe", " *@id.cafeore.cafe ", "*@ID.Cafeore.Cafe", "*@id-1.example.com"} {
		if _, err := NewAuthorizer([]string{entry}, nil); err != nil {
			t.Errorf("NewAuthorizer(%q): %v", entry, err)
		}
	}
}

func TestAuthorizerFromEnv(t *testing.T) {
	const iapAudience = "/projects/123456789/global/backendServices/987654321"
	complete := map[string]string{
		"AUTH_MODE":             "cloudflare-access",
		"CF_ACCESS_TEAM_DOMAIN": "cafeore.cloudflareaccess.com",
		"CF_ACCESS_AUD":         "aud-tag",
		"IAP_AUDIENCE":          iapAudience,
		"AUTH_STAFF_EMAILS":     "register@example.com, master@example.com",
		"AUTH_VIEWER_EMAILS":    "display@example.com",
	}
	// complete を key, value, key, value… で上書きしたもの
	with := func(kv ...string) map[string]string {
		m := map[string]string{}
		for k, v := range complete {
			m[k] = v
		}
		for i := 0; i+1 < len(kv); i += 2 {
			m[kv[i]] = kv[i+1]
		}
		return m
	}
	access := []string{AccessJWTHeader}
	iap := []string{IAPJWTHeader}
	both := []string{AccessJWTHeader, IAPJWTHeader}

	cases := map[string]struct {
		env            map[string]string
		wantNil        bool
		wantErr        bool
		wantReportOnly bool
		wantHeaders    []string
	}{
		"unset":       {env: map[string]string{}, wantNil: true},
		"off":         {env: map[string]string{"AUTH_MODE": "off"}, wantNil: true},
		"complete":    {env: complete, wantHeaders: access},
		"no viewer":   {env: with("AUTH_VIEWER_EMAILS", ""), wantHeaders: access},
		"report-only": {env: with("AUTH_MODE", "cloudflare-access-report-only"), wantReportOnly: true, wantHeaders: access},
		// cloudflare-access だけなら IAP_AUDIENCE は要らない
		"access without iap audience": {env: with("IAP_AUDIENCE", ""), wantHeaders: access},
		// report-only でも設定の漏れは起動を止める
		"report-only no aud": {env: with("AUTH_MODE", "cloudflare-access-report-only", "CF_ACCESS_AUD", ""), wantErr: true},
		// 綴りを誤ったら認証が外れるのではなく、起動を止める
		"typo":          {env: with("AUTH_MODE", "cloudflare_access"), wantErr: true},
		"no team":       {env: with("CF_ACCESS_TEAM_DOMAIN", ""), wantErr: true},
		"no aud":        {env: with("CF_ACCESS_AUD", " "), wantErr: true},
		"no staff":      {env: with("AUTH_STAFF_EMAILS", " , "), wantErr: true},
		"broken domain": {env: with("CF_ACCESS_TEAM_DOMAIN", "https://x.cloudflareaccess.com/path"), wantErr: true},

		"iap":             {env: with("AUTH_MODE", "iap"), wantHeaders: iap},
		"iap-report-only": {env: with("AUTH_MODE", "iap-report-only"), wantReportOnly: true, wantHeaders: iap},
		// iap だけなら CF_ACCESS_* は要らない
		"iap without access":          {env: with("AUTH_MODE", "iap", "CF_ACCESS_TEAM_DOMAIN", "", "CF_ACCESS_AUD", ""), wantHeaders: iap},
		"iap audiences":               {env: with("AUTH_MODE", "iap", "IAP_AUDIENCE", iapAudience+", /projects/1/global/backendServices/2"), wantHeaders: iap},
		"iap no audience":             {env: with("AUTH_MODE", "iap", "IAP_AUDIENCE", " , "), wantErr: true},
		"iap broken audience":         {env: with("AUTH_MODE", "iap", "IAP_AUDIENCE", "987654321"), wantErr: true},
		"iap report-only no audience": {env: with("AUTH_MODE", "iap-report-only", "IAP_AUDIENCE", ""), wantErr: true},
		"iap no staff":                {env: with("AUTH_MODE", "iap", "AUTH_STAFF_EMAILS", ""), wantErr: true},

		"both":             {env: with("AUTH_MODE", "cloudflare-access+iap"), wantHeaders: both},
		"both report-only": {env: with("AUTH_MODE", "cloudflare-access+iap-report-only"), wantReportOnly: true, wantHeaders: both},
		// 並べた順によらず、確かめる順は同じ
		"both reversed":             {env: with("AUTH_MODE", "iap+cloudflare-access"), wantHeaders: both},
		"both reversed report-only": {env: with("AUTH_MODE", "iap+cloudflare-access-report-only"), wantReportOnly: true, wantHeaders: both},
		// 片方の設定が漏れていても起動を止める
		"both no access aud":   {env: with("AUTH_MODE", "cloudflare-access+iap", "CF_ACCESS_AUD", ""), wantErr: true},
		"both no iap audience": {env: with("AUTH_MODE", "cloudflare-access+iap-report-only", "IAP_AUDIENCE", ""), wantErr: true},

		"duplicate iap":          {env: with("AUTH_MODE", "iap+iap"), wantErr: true},
		"duplicate access":       {env: with("AUTH_MODE", "cloudflare-access+iap+cloudflare-access"), wantErr: true},
		"unknown method":         {env: with("AUTH_MODE", "cloudflare-access+google"), wantErr: true},
		"empty method":           {env: with("AUTH_MODE", "iap+"), wantErr: true},
		"empty first method":     {env: with("AUTH_MODE", "+iap"), wantErr: true},
		"double plus":            {env: with("AUTH_MODE", "cloudflare-access++iap"), wantErr: true},
		"spaces around plus":     {env: with("AUTH_MODE", "cloudflare-access + iap"), wantErr: true},
		"upper case":             {env: with("AUTH_MODE", "IAP"), wantErr: true},
		"report-only alone":      {env: with("AUTH_MODE", "-report-only"), wantErr: true},
		"off report-only":        {env: with("AUTH_MODE", "off-report-only"), wantErr: true},
		"off and iap":            {env: with("AUTH_MODE", "off+iap"), wantErr: true},
		"report-only inside":     {env: with("AUTH_MODE", "iap-report-only+cloudflare-access"), wantErr: true},
		"report-only twice":      {env: with("AUTH_MODE", "iap-report-only-report-only"), wantErr: true},
		"report-only per method": {env: with("AUTH_MODE", "cloudflare-access-report-only+iap-report-only"), wantErr: true},

		"staff domain":           {env: with("AUTH_MODE", "iap", "AUTH_STAFF_EMAILS", "*@id.cafeore.cafe"), wantHeaders: iap},
		"viewer domain":          {env: with("AUTH_VIEWER_EMAILS", "*@id.cafeore.cafe, display@example.com"), wantHeaders: access},
		"staff bad domain":       {env: with("AUTH_STAFF_EMAILS", "register@example.com, *id.cafeore.cafe"), wantErr: true},
		"viewer bad domain":      {env: with("AUTH_VIEWER_EMAILS", "*"), wantErr: true},
		"report-only bad domain": {env: with("AUTH_MODE", "iap-report-only", "AUTH_STAFF_EMAILS", "*@"), wantErr: true},
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
			case !slices.Equal(authz.Headers(), tc.wantHeaders):
				t.Fatalf("Headers() = %v, want %v", authz.Headers(), tc.wantHeaders)
			}
		})
	}

	domain, err := AuthorizerFromEnv(func(k string) string {
		return with(
			"AUTH_MODE", "iap",
			"AUTH_STAFF_EMAILS", " *@ID.cafeore.cafe ",
			"AUTH_VIEWER_EMAILS", "callscreen@id.cafeore.cafe",
		)[k]
	})
	if err != nil {
		t.Fatal(err)
	}
	for email, role := range map[string]Role{
		"someone@id.cafeore.cafe":    RoleStaff,
		"callscreen@id.cafeore.cafe": RoleViewer,
		"foo@x.id.cafeore.cafe":      RoleNone,
	} {
		if got := domain.role(AccessIdentity{Email: email}); got != role {
			t.Errorf("domain: role(%q) = %d, want %d", email, got, role)
		}
	}

	for _, mode := range []string{"cloudflare-access", "iap", "cloudflare-access+iap"} {
		authz, err := AuthorizerFromEnv(func(k string) string { return with("AUTH_MODE", mode)[k] })
		if err != nil {
			t.Fatal(err)
		}
		want := map[string]Role{
			"register@example.com": RoleStaff,
			"master@example.com":   RoleStaff,
			"display@example.com":  RoleViewer,
		}
		for name, role := range want {
			if got := authz.roles[name]; got != role {
				t.Errorf("%s: roles[%q] = %d, want %d", mode, name, got, role)
			}
		}
	}
}
