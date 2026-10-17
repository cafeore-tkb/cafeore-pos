package auth

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-jose/go-jose/v4"
	"github.com/go-jose/go-jose/v4/jwt"
)

// Access のチームのドメインに見立てた鍵の配布元と、その鍵で署名したトークンを作る。
type fakeAccess struct {
	server *httptest.Server
	key    *rsa.PrivateKey
}

func newFakeAccess(t *testing.T) *fakeAccess {
	t.Helper()

	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	jwks := jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{
		Key: &key.PublicKey, KeyID: "k1", Algorithm: string(jose.RS256), Use: "sig",
	}}}

	mux := http.NewServeMux()
	mux.HandleFunc("/cdn-cgi/access/certs", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode(jwks)
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	return &fakeAccess{server: server, key: key}
}

func (f *fakeAccess) sign(t *testing.T, key *rsa.PrivateKey, claims map[string]any) string {
	t.Helper()

	signer, err := jose.NewSigner(
		jose.SigningKey{Algorithm: jose.RS256, Key: key},
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

func TestAccessVerifier(t *testing.T) {
	const audience = "aud-tag"
	access := newFakeAccess(t)

	otherKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now()
	valid := map[string]any{
		"iss": access.server.URL,
		// Access の aud は配列で来る
		"aud":   []string{audience},
		"email": "register@example.com",
		"iat":   now.Unix(),
		"exp":   now.Add(time.Hour).Unix(),
	}
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

	serviceToken := with("email", nil)
	serviceToken["common_name"] = "client-id.access"

	cases := map[string]struct {
		token string
		want  string // 通るときの Name()。空なら弾かれる
	}{
		"ok":            {access.sign(t, access.key, valid), "register@example.com"},
		"service token": {access.sign(t, access.key, serviceToken), "client-id.access"},
		"other aud":     {access.sign(t, access.key, with("aud", []string{"someone-else"})), ""},
		"other iss":     {access.sign(t, access.key, with("iss", "https://evil.cloudflareaccess.com")), ""},
		"expired":       {access.sign(t, access.key, with("exp", now.Add(-time.Minute).Unix())), ""},
		"other key":     {access.sign(t, otherKey, valid), ""},
		"no identity":   {access.sign(t, access.key, with("email", nil)), ""},
		"garbage":       {"not-a-jwt", ""},
		"empty":         {"", ""},
	}

	v, err := NewAccessVerifier(access.server.URL+"/", audience)
	if err != nil {
		t.Fatal(err)
	}

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

func TestNormalizeTeamDomain(t *testing.T) {
	cases := map[string]string{
		"cafeore.cloudflareaccess.com":          "https://cafeore.cloudflareaccess.com",
		"https://cafeore.cloudflareaccess.com":  "https://cafeore.cloudflareaccess.com",
		"https://cafeore.cloudflareaccess.com/": "https://cafeore.cloudflareaccess.com",
		" cafeore.cloudflareaccess.com ":        "https://cafeore.cloudflareaccess.com",
		"":                                      "",
		"https://cafeore.cloudflareaccess.com/cdn-cgi/access/certs": "",
	}
	for in, want := range cases {
		got, err := normalizeTeamDomain(in)
		if want == "" {
			if err == nil {
				t.Errorf("normalizeTeamDomain(%q) = %q, want error", in, got)
			}
			continue
		}
		if err != nil || got != want {
			t.Errorf("normalizeTeamDomain(%q) = %q, %v, want %q", in, got, err, want)
		}
	}
}
