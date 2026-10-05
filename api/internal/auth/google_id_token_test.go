package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGoogleIDTokenVerifier(t *testing.T) {
	const (
		audience = "cafeore-pos-inventory-remind"
		email    = "scheduler@example.iam.gserviceaccount.com"
	)
	valid := map[string]string{
		"iss":            "https://accounts.google.com",
		"aud":            audience,
		"email":          email,
		"email_verified": "true",
	}
	with := func(key, value string) map[string]string {
		m := map[string]string{}
		for k, v := range valid {
			m[k] = v
		}
		m[key] = value
		return m
	}

	// トークン文字列ごとに tokeninfo の応答を決める
	responses := map[string]map[string]string{
		"ok":          valid,
		"other-aud":   with("aud", "https://example.com"),
		"other-email": with("email", "someone@example.com"),
		"unverified":  with("email_verified", "false"),
		"other-iss":   with("iss", "https://evil.example.com"),
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, ok := responses[r.URL.Query().Get("id_token")]
		if !ok {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(body)
	}))
	defer server.Close()

	v := NewGoogleIDTokenVerifier(audience, email)
	v.endpoint = server.URL

	cases := map[string]bool{
		"ok":          true,
		"other-aud":   false,
		"other-email": false,
		"unverified":  false,
		"other-iss":   false,
		"expired":     false,
		"":            false,
	}
	for token, want := range cases {
		err := v.Verify(context.Background(), token)
		if (err == nil) != want {
			t.Errorf("Verify(%q) = %v, want ok=%v", token, err, want)
		}
	}
}
