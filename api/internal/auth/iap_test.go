package auth

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

const testIAPAudience = "/projects/123456789/global/backendServices/987654321"

// IAP の鍵の配布元（www.gstatic.com/iap/verify/public_key-jwk）に見立てたものと、
// その鍵で署名したトークンを作る。
type fakeIAP struct {
	server *httptest.Server
	key    *ecdsa.PrivateKey
}

func newFakeIAP(t *testing.T) *fakeIAP {
	t.Helper()

	key := newECKey(t)
	jwks := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{
		Key: &key.PublicKey, KeyID: "k1", Algorithm: string(jose.ES256), Use: "sig",
	}}}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(jwks)
	}))
	t.Cleanup(server.Close)

	return &fakeIAP{server: server, key: key}
}

func newECKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	return key
}

func (f *fakeIAP) verifier(t *testing.T, audiences ...string) *IAPVerifier {
	t.Helper()

	v, err := newIAPVerifier(audiences, f.server.URL)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

// IAP が付けてくるものと同じ形のクレーム
func iapClaims(email string) map[string]any {
	now := time.Now()
	return map[string]any{
		"iss": iapIssuer,
		// IAP の aud は文字列で来る
		"aud":   testIAPAudience,
		"sub":   "accounts.google.com:1234567890",
		"email": email,
		"iat":   now.Unix(),
		"exp":   now.Add(10 * time.Minute).Unix(),
	}
}

func signJWT(t *testing.T, alg jose.SignatureAlgorithm, key any, claims map[string]any) string {
	t.Helper()

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: alg, Key: key},
		(&jose.SignerOptions{}).WithType("JWT").WithHeader("kid", "k1"),
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

func TestIAPVerifier(t *testing.T) {
	iap := newFakeIAP(t)
	otherKey := newECKey(t)
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

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
	sign := func(claims map[string]any) string { return signJWT(t, jose.ES256, iap.key, claims) }

	cases := map[string]struct {
		token string
		want  string // 通るときの Name()。空なら弾かれる
	}{
		"ok": {sign(valid), "register@example.com"},
		// IAP_AUDIENCE に並べたどれかに一致すれば通す
		"second audience": {sign(with("aud", "/projects/1/global/backendServices/2")), "register@example.com"},
		"aud array":       {sign(with("aud", []string{"someone-else", testIAPAudience})), "register@example.com"},
		"other aud":       {sign(with("aud", "/projects/123456789/global/backendServices/1")), ""},
		"no aud":          {sign(with("aud", nil)), ""},
		"other iss":       {sign(with("iss", "https://cloud.google.com/iap/evil")), ""},
		"access iss":      {sign(with("iss", "https://cafeore.cloudflareaccess.com")), ""},
		"expired":         {sign(with("exp", time.Now().Add(-time.Minute).Unix())), ""},
		"no exp":          {sign(with("exp", nil)), ""},
		"other key":       {signJWT(t, jose.ES256, otherKey, valid), ""},
		// IAP は ES256 だけ。同じ kid でもほかのアルゴリズムは受け付けない
		"rs256":    {signJWT(t, jose.RS256, rsaKey, valid), ""},
		"no email": {sign(with("email", nil)), ""},
		"garbage":  {"not-a-jwt", ""},
		"empty":    {"", ""},
	}

	v := iap.verifier(t, testIAPAudience, "/projects/1/global/backendServices/2")
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

func TestNewIAPVerifierConfig(t *testing.T) {
	cases := map[string]struct {
		audiences []string
		wantErr   bool
	}{
		"one":  {[]string{testIAPAudience}, false},
		"two":  {[]string{testIAPAudience, "/projects/1/global/backendServices/2"}, false},
		"none": {nil, true},
		// backend service の数字の ID や名前だけを入れたもの
		"id only":   {[]string{"987654321"}, true},
		"name only": {[]string{"cafeore-pos-api"}, true},
		"one bad":   {[]string{testIAPAudience, "987654321"}, true},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := NewIAPVerifier(tc.audiences)
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

// 本物の検証器を 2 つ並べたとき（cloudflare-access+iap）。署名した JWT で確かめる
func TestAuthorizerAccessAndIAP(t *testing.T) {
	gin.SetMode(gin.TestMode)

	const accessAudience = "aud-tag"
	access := newFakeAccess(t)
	accessVerifier, err := NewAccessVerifier(access.server.URL, accessAudience)
	if err != nil {
		t.Fatal(err)
	}
	iap := newFakeIAP(t)

	authz := NewAuthorizer(
		[]string{"staff@example.com"},
		[]string{"display@example.com"},
		accessVerifier,
		iap.verifier(t, testIAPAudience),
	)
	r := gin.New()
	r.POST("/api/orders", authz.RequireByMethod(), func(c *gin.Context) { c.Status(http.StatusOK) })

	now := time.Now()
	accessToken := func(email string) string {
		return access.sign(t, access.key, map[string]any{
			"iss":   access.server.URL,
			"aud":   []string{accessAudience},
			"email": email,
			"iat":   now.Unix(),
			"exp":   now.Add(time.Hour).Unix(),
		})
	}
	iapToken := func(email string) string { return signJWT(t, jose.ES256, iap.key, iapClaims(email)) }
	expiredIAP := iapClaims("staff@example.com")
	expiredIAP["exp"] = now.Add(-time.Minute).Unix()
	otherAudIAP := iapClaims("staff@example.com")
	otherAudIAP["aud"] = "/projects/123456789/global/backendServices/1"

	cases := map[string]struct {
		headers map[string]string
		want    int
	}{
		"none":          {map[string]string{}, http.StatusUnauthorized},
		"access":        {map[string]string{AccessJWTHeader: accessToken("staff@example.com")}, http.StatusOK},
		"iap":           {map[string]string{IAPJWTHeader: iapToken("staff@example.com")}, http.StatusOK},
		"iap viewer":    {map[string]string{IAPJWTHeader: iapToken("display@example.com")}, http.StatusForbidden},
		"iap stranger":  {map[string]string{IAPJWTHeader: iapToken("stranger@example.com")}, http.StatusForbidden},
		"iap expired":   {map[string]string{IAPJWTHeader: signJWT(t, jose.ES256, iap.key, expiredIAP)}, http.StatusUnauthorized},
		"iap other aud": {map[string]string{IAPJWTHeader: signJWT(t, jose.ES256, iap.key, otherAudIAP)}, http.StatusUnauthorized},
		// ヘッダーを取り違えたトークンは、そのヘッダーの検証器で弾かれる
		"access token in iap header": {map[string]string{IAPJWTHeader: accessToken("staff@example.com")}, http.StatusUnauthorized},
		"iap token in access header": {map[string]string{AccessJWTHeader: iapToken("staff@example.com")}, http.StatusUnauthorized},
		"both": {map[string]string{
			AccessJWTHeader: accessToken("staff@example.com"),
			IAPJWTHeader:    iapToken("staff@example.com"),
		}, http.StatusOK},
		// 両方付いていたら、両方とも正しくないと通さない
		"access ok iap expired": {map[string]string{
			AccessJWTHeader: accessToken("staff@example.com"),
			IAPJWTHeader:    signJWT(t, jose.ES256, iap.key, expiredIAP),
		}, http.StatusUnauthorized},
		"iap ok access forged": {map[string]string{
			AccessJWTHeader: iapToken("staff@example.com"),
			IAPJWTHeader:    iapToken("staff@example.com"),
		}, http.StatusUnauthorized},
		// 両方正しければ弱い方の権限で見る
		"access staff iap viewer": {map[string]string{
			AccessJWTHeader: accessToken("staff@example.com"),
			IAPJWTHeader:    iapToken("display@example.com"),
		}, http.StatusForbidden},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/orders", nil)
			for k, v := range tc.headers {
				req.Header.Set(k, v)
			}
			w := httptest.NewRecorder()
			r.ServeHTTP(w, req)
			if w.Code != tc.want {
				t.Fatalf("got %d, want %d", w.Code, tc.want)
			}
		})
	}
}
