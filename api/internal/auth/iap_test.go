package auth

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

const (
	testIAPAudience      = "/projects/123456789012/global/backendServices/1111111111111111111"
	testIAPOtherAudience = "/projects/123456789012/global/backendServices/2222222222222222222"
)

// gstatic の鍵の配布元に見立てたサーバー。鍵を足せて、取りに来た回数を数える。
type fakeIAP struct {
	server *httptest.Server

	mu      sync.Mutex
	keys    []jose.JSONWebKey
	fetches int
}

func newFakeIAP(t *testing.T) *fakeIAP {
	t.Helper()

	f := &fakeIAP{}
	f.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		f.fetches++
		_ = json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: f.keys})
	}))
	t.Cleanup(f.server.Close)
	return f
}

func (f *fakeIAP) addKey(kid string, alg jose.SignatureAlgorithm, public any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.keys = append(f.keys, jose.JSONWebKey{Key: public, KeyID: kid, Algorithm: string(alg), Use: "sig"})
}

func (f *fakeIAP) fetchCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.fetches
}

func (f *fakeIAP) verifier(t *testing.T, audiences ...string) *IAPVerifier {
	t.Helper()

	v, err := newIAPVerifier(f.server.URL, audiences)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func newP256Key(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func signIAP(t *testing.T, alg jose.SignatureAlgorithm, key any, kid string, claims map[string]any) string {
	t.Helper()

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: alg, Key: key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", kid),
	)
	if err != nil {
		t.Fatal(err)
	}
	token, err := jwt.Signed(signer).Claims(claims).Serialize()
	if err != nil {
		t.Fatal(err)
	}
	return token
}

// IAP が付けてくるものと同じ形のクレーム
func iapClaims(email string) map[string]any {
	now := time.Now()
	return map[string]any{
		"iss":   "https://cloud.google.com/iap",
		"aud":   testIAPAudience,
		"sub":   "accounts.google.com:1234567890",
		"email": email,
		"iat":   now.Unix(),
		"exp":   now.Add(10 * time.Minute).Unix(),
	}
}

func TestIAPVerifier(t *testing.T) {
	iap := newFakeIAP(t)
	key := newP256Key(t)
	iap.addKey("k1", jose.ES256, &key.PublicKey)

	// アルゴリズムだけで弾かれることを確かめるため、RSA の公開鍵も配っておく
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	iap.addKey("rsa", jose.RS256, &rsaKey.PublicKey)

	otherKey := newP256Key(t)

	now := time.Now()
	valid := iapClaims("register@example.com")
	with := func(key string, value any) map[string]any {
		m := map[string]any{}
		for k, v := range valid {
			m[k] = v
		}
		if value == nil {
			delete(m, key)
		} else {
			m[key] = value
		}
		return m
	}
	es256 := func(claims map[string]any) string { return signIAP(t, jose.ES256, key, "k1", claims) }

	cases := map[string]struct {
		token string
		want  string // 通るときの Name()。空なら弾かれる
	}{
		"ok":              {es256(valid), "register@example.com"},
		"other backend":   {es256(with("aud", testIAPOtherAudience)), "register@example.com"},
		"other aud":       {es256(with("aud", "/projects/123456789012/global/backendServices/3333333333333333333")), ""},
		"no aud":          {es256(with("aud", nil)), ""},
		"other iss":       {es256(with("iss", "https://accounts.google.com")), ""},
		"expired":         {es256(with("exp", now.Add(-time.Minute).Unix())), ""},
		"expired in skew": {es256(with("exp", now.Add(-10*time.Second).Unix())), "register@example.com"},
		"no exp":          {es256(with("exp", nil)), ""},
		"future iat":      {es256(with("iat", now.Add(time.Minute).Unix())), ""},
		"no iat":          {es256(with("iat", nil)), ""},
		"no email":        {es256(with("email", nil)), ""},
		"blank email":     {es256(with("email", " ")), ""},
		"other key":       {signIAP(t, jose.ES256, otherKey, "k1", valid), ""},
		"rs256":           {signIAP(t, jose.RS256, rsaKey, "rsa", valid), ""},
		// HMAC で署名した偽のトークン（配っている公開鍵を HMAC の鍵に見立てる攻撃など）
		"hs256":   {signIAP(t, jose.HS256, []byte("0123456789abcdef0123456789abcdef"), "k1", valid), ""},
		"garbage": {"not-a-jwt", ""},
		"empty":   {"", ""},
	}

	v := iap.verifier(t, testIAPAudience, testIAPOtherAudience)
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			identity, err := v.Verify(context.Background(), tc.token)
			if tc.want == "" {
				if err == nil {
					t.Fatalf("want error, got %+v", identity)
				}
				return
			}
			if err != nil {
				t.Fatalf("want ok, got %v", err)
			}
			if got := identity.Name(); got != tc.want {
				t.Fatalf("Name() = %q, want %q", got, tc.want)
			}
		})
	}
}

// IAP が鍵を替えても、知らない kid のトークンが来たら取り直して追従する
func TestIAPVerifierRefetchesKeys(t *testing.T) {
	iap := newFakeIAP(t)
	oldKey := newP256Key(t)
	iap.addKey("old", jose.ES256, &oldKey.PublicKey)
	v := iap.verifier(t, testIAPAudience)

	verify := func(key *ecdsa.PrivateKey, kid string) {
		t.Helper()
		token := signIAP(t, jose.ES256, key, kid, iapClaims("register@example.com"))
		if _, err := v.Verify(context.Background(), token); err != nil {
			t.Fatalf("kid %q: %v", kid, err)
		}
	}

	verify(oldKey, "old")
	verify(oldKey, "old")
	if n := iap.fetchCount(); n != 1 {
		t.Fatalf("fetched %d times before rotation, want 1", n)
	}

	newKey := newP256Key(t)
	iap.addKey("new", jose.ES256, &newKey.PublicKey)
	verify(newKey, "new")
	verify(oldKey, "old")
	if n := iap.fetchCount(); n != 2 {
		t.Fatalf("fetched %d times after rotation, want 2", n)
	}
}

// main.go と同じ組み方で、IAP のヘッダーの JWT だけを見て権限に振り分ける
func TestIAPAuthorizer(t *testing.T) {
	gin.SetMode(gin.TestMode)

	iap := newFakeIAP(t)
	key := newP256Key(t)
	iap.addKey("k1", jose.ES256, &key.PublicKey)
	token := func(email string) string { return signIAP(t, jose.ES256, key, "k1", iapClaims(email)) }

	authz := NewAuthorizer(iap.verifier(t, testIAPAudience), []string{"register@example.com"}, []string{"display@example.com"})

	r := gin.New()
	ok := func(c *gin.Context) { c.Status(http.StatusOK) }
	api := r.Group("/api", authz.RequireByMethod())
	api.GET("/orders", ok)
	api.POST("/orders", ok)

	cases := []struct {
		name, method string
		header       map[string]string
		want         int
	}{
		{"no token", "GET", nil, http.StatusUnauthorized},
		{"viewer reads", "GET", map[string]string{IAPJWTHeader: token("display@example.com")}, http.StatusOK},
		{"viewer writes", "POST", map[string]string{IAPJWTHeader: token("display@example.com")}, http.StatusForbidden},
		{"stranger", "GET", map[string]string{IAPJWTHeader: token("stranger@example.com")}, http.StatusForbidden},
		// 大文字・小文字は区別しない
		{"staff writes", "POST", map[string]string{IAPJWTHeader: token("Register@Example.com")}, http.StatusOK},
		// iap のときは Access のヘッダーを見ない
		{"access header", "POST", map[string]string{AccessJWTHeader: token("register@example.com")}, http.StatusUnauthorized},
		// 署名の無いメールのヘッダーは信じない
		{"unsigned email", "POST", map[string]string{"X-Goog-Authenticated-User-Email": "accounts.google.com:register@example.com"}, http.StatusUnauthorized},
	}
	for _, tc := range cases {
		req := httptest.NewRequest(tc.method, "/api/orders", nil)
		for k, v := range tc.header {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Errorf("%s: got %d, want %d", tc.name, w.Code, tc.want)
		}
	}

	// ロードバランサーからは小文字のヘッダー名で届くことがある。net/http が揃えるので見つかる
	server := httptest.NewServer(r)
	t.Cleanup(server.Close)
	req, err := http.NewRequest("POST", server.URL+"/api/orders", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header["x-goog-iap-jwt-assertion"] = []string{token("register@example.com")}
	res, err := server.Client().Do(req)
	if err != nil {
		t.Fatal(err)
	}
	_ = res.Body.Close()
	if res.StatusCode != http.StatusOK {
		t.Errorf("lower-case header: got %d, want 200", res.StatusCode)
	}
}

// iap-report-only は弾かずに通し、弾くはずだったものをログに出す。iap は弾く。
func TestIAPAuthorizerReportOnly(t *testing.T) {
	gin.SetMode(gin.TestMode)

	var logs bytes.Buffer
	log.SetOutput(&logs)
	t.Cleanup(func() { log.SetOutput(os.Stderr) })

	iap := newFakeIAP(t)
	key := newP256Key(t)
	iap.addKey("k1", jose.ES256, &key.PublicKey)

	env := map[string]string{
		"IAP_AUDIENCE":       testIAPAudience,
		"AUTH_STAFF_EMAILS":  "register@example.com",
		"AUTH_VIEWER_EMAILS": "display@example.com",
	}
	serve := func(mode string, header map[string]string) int {
		t.Helper()
		env["AUTH_MODE"] = mode
		authz, err := AuthorizerFromEnv(func(k string) string { return env[k] })
		if err != nil {
			t.Fatal(err)
		}
		// 鍵は gstatic ではなくテストのサーバーから取らせる
		authz.verifier = iap.verifier(t, testIAPAudience)

		r := gin.New()
		r.POST("/api/orders", authz.RequireByMethod(), func(c *gin.Context) { c.Status(http.StatusOK) })
		req := httptest.NewRequest("POST", "/api/orders", nil)
		for k, v := range header {
			req.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		return w.Code
	}

	staff := map[string]string{IAPJWTHeader: signIAP(t, jose.ES256, key, "k1", iapClaims("register@example.com"))}
	display := map[string]string{IAPJWTHeader: signIAP(t, jose.ES256, key, "k1", iapClaims("display@example.com"))}

	for name, header := range map[string]map[string]string{
		"no token": nil,
		"garbage":  {IAPJWTHeader: "not-a-jwt"},
		"display":  display,
		"staff":    staff,
	} {
		if got := serve("iap-report-only", header); got != http.StatusOK {
			t.Errorf("report-only, %s: got %d, want 200", name, got)
		}
	}

	got := logs.String()
	for _, want := range []string{
		"would reject POST /api/orders with 401",
		`would reject POST /api/orders with 403: "display@example.com" is not allowed`,
	} {
		if !strings.Contains(got, want) {
			t.Errorf("log does not contain %q:\n%s", want, got)
		}
	}
	if strings.Contains(got, "register@example.com") {
		t.Errorf("allowed request was logged:\n%s", got)
	}

	if got := serve("iap", nil); got != http.StatusUnauthorized {
		t.Errorf("enforce without token: got %d, want 401", got)
	}
	if got := serve("iap", display); got != http.StatusForbidden {
		t.Errorf("enforce as display: got %d, want 403", got)
	}
	if got := serve("iap", staff); got != http.StatusOK {
		t.Errorf("enforce as staff: got %d, want 200", got)
	}
}

func TestAuthorizerFromEnvIAP(t *testing.T) {
	complete := map[string]string{
		"AUTH_MODE":          "iap",
		"IAP_AUDIENCE":       testIAPAudience,
		"AUTH_STAFF_EMAILS":  "register@example.com, master@example.com",
		"AUTH_VIEWER_EMAILS": "display@example.com",
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
		wantErr        bool
		wantReportOnly bool
		wantAudiences  []string
	}{
		"complete":    {env: complete, wantAudiences: []string{testIAPAudience}},
		"report-only": {env: with("AUTH_MODE", "iap-report-only"), wantReportOnly: true, wantAudiences: []string{testIAPAudience}},
		"multiple audiences": {
			env:           with("IAP_AUDIENCE", " "+testIAPAudience+" , "+testIAPOtherAudience+","),
			wantAudiences: []string{testIAPAudience, testIAPOtherAudience},
		},
		// Access の設定が残っていても IAP の設定が無ければ起動を止める
		"no audience": {env: func() map[string]string {
			m := with("IAP_AUDIENCE", "")
			m["CF_ACCESS_TEAM_DOMAIN"] = "cafeore.cloudflareaccess.com"
			m["CF_ACCESS_AUD"] = "aud-tag"
			return m
		}(), wantErr: true},
		"blank audience":          {env: with("IAP_AUDIENCE", " , "), wantErr: true},
		"report-only no audience": {env: map[string]string{"AUTH_MODE": "iap-report-only", "AUTH_STAFF_EMAILS": "register@example.com"}, wantErr: true},
		"no staff":                {env: with("AUTH_STAFF_EMAILS", ""), wantErr: true},
		"typo":                    {env: with("AUTH_MODE", "IAP"), wantErr: true},
		"report-only typo":        {env: with("AUTH_MODE", "iap-reportonly"), wantErr: true},
		// Terraform の google_compute_backend_service の id（generated_id ではない）を渡した
		"backend service name":       {env: with("IAP_AUDIENCE", "projects/cafeore-pos/global/backendServices/pos-api"), wantErr: true},
		"project id, not number":     {env: with("IAP_AUDIENCE", "/projects/cafeore-pos/global/backendServices/1111111111111111111"), wantErr: true},
		"one of them broken":         {env: with("IAP_AUDIENCE", testIAPAudience+",pos-api"), wantErr: true},
		"cloud run url, not backend": {env: with("IAP_AUDIENCE", "https://cafeore-pos-prod-xxxxx.a.run.app"), wantErr: true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			authz, err := AuthorizerFromEnv(func(k string) string { return tc.env[k] })
			if tc.wantErr {
				if err == nil {
					t.Fatal("want error")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if authz.ReportOnly() != tc.wantReportOnly {
				t.Fatalf("ReportOnly() = %v, want %v", authz.ReportOnly(), tc.wantReportOnly)
			}
			v, ok := authz.verifier.(*IAPVerifier)
			if !ok {
				t.Fatalf("verifier = %T, want *IAPVerifier", authz.verifier)
			}
			if v.Header() != IAPJWTHeader {
				t.Fatalf("Header() = %q", v.Header())
			}
			if !slices.Equal(v.audiences, tc.wantAudiences) {
				t.Fatalf("audiences = %q, want %q", v.audiences, tc.wantAudiences)
			}
			if got := authz.roles["display@example.com"]; got != RoleViewer {
				t.Fatalf("roles[display] = %d, want %d", got, RoleViewer)
			}
		})
	}
}
