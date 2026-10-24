// api/internal/auth/iap.go
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// GCP の Identity-Aware Proxy（IAP）がリクエストに付けてくる JWT のヘッダー。
const IAPJWTHeader = "X-Goog-Iap-Jwt-Assertion"

const (
	iapIssuer  = "https://cloud.google.com/iap"
	iapKeysURL = "https://www.gstatic.com/iap/verify/public_key-jwk"
)

// IAP が付けてくる JWT（X-Goog-Iap-Jwt-Assertion）を検証する。
//
// GCP の外部アプリケーション LB の backend に IAP を掛けると、IAP がその手前で
// Google アカウントでログインさせ、通したリクエストにこの JWT を付ける。LB を
// 通らずに Cloud Run を叩かれても通さないよう、ここで署名・発行元・audience・
// 期限を確かめ、IAP を通ってきたものだけを受け付ける。
//
// 鍵は Google が公開している JWK（ES256）。知らない kid のトークンが来たら
// 取り直すので、鍵が替わっても追従する。
type IAPVerifier struct {
	verifier  *oidc.IDTokenVerifier
	audiences []string
}

var ErrInvalidIAPToken = errors.New("invalid iap token")

// audiences は JWT の aud として受け付ける値。backend service に IAP を掛けたときは
// /projects/<プロジェクト番号>/global/backendServices/<backend service の数字の ID>。
// どれか 1 つに一致すれば通す。
func NewIAPVerifier(audiences []string) (*IAPVerifier, error) {
	return newIAPVerifier(audiences, iapKeysURL)
}

// テストでは鍵の配布元を差し替える。
func newIAPVerifier(audiences []string, keysURL string) (*IAPVerifier, error) {
	if len(audiences) == 0 {
		return nil, errors.New("iap audience is empty")
	}
	for _, audience := range audiences {
		// backend service の名前や数字の ID だけを入れる誤りを、起動の時点で止める
		if !strings.HasPrefix(audience, "/projects/") {
			return nil, fmt.Errorf("invalid iap audience %q (want /projects/<number>/global/backendServices/<id>)", audience)
		}
	}

	// 鍵の取得が詰まっても、リクエストを長く待たせない
	ctx := oidc.ClientContext(context.Background(), &http.Client{Timeout: 5 * time.Second})
	keySet := oidc.NewRemoteKeySet(ctx, keysURL)

	return &IAPVerifier{
		verifier: oidc.NewVerifier(iapIssuer, keySet, &oidc.Config{
			// aud は複数を許すので、go-oidc（1 つしか見られない）には任せず Verify で見る
			SkipClientIDCheck:    true,
			SupportedSigningAlgs: []string{oidc.ES256},
		}),
		audiences: slices.Clone(audiences),
	}, nil
}

func (v *IAPVerifier) Header() string {
	return IAPJWTHeader
}

func (v *IAPVerifier) Verify(ctx context.Context, token string) (AccessIdentity, error) {
	if token == "" {
		return AccessIdentity{}, ErrInvalidIAPToken
	}

	idToken, err := v.verifier.Verify(ctx, token)
	if err != nil {
		return AccessIdentity{}, fmt.Errorf("%w: %v", ErrInvalidIAPToken, err)
	}
	if !slices.ContainsFunc(idToken.Audience, func(aud string) bool { return slices.Contains(v.audiences, aud) }) {
		return AccessIdentity{}, fmt.Errorf("%w: unexpected audience %q", ErrInvalidIAPToken, idToken.Audience)
	}

	var claims struct {
		Email string `json:"email"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return AccessIdentity{}, fmt.Errorf("%w: %v", ErrInvalidIAPToken, err)
	}
	if claims.Email == "" {
		return AccessIdentity{}, fmt.Errorf("%w: no email", ErrInvalidIAPToken)
	}
	return AccessIdentity{Email: claims.Email}, nil
}
