// api/internal/auth/iap.go
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// IAP（Identity-Aware Proxy）がリクエストに付けてくる JWT のヘッダー。
const IAPJWTHeader = "X-Goog-IAP-JWT-Assertion"

const (
	// IAP が署名した JWT の iss
	iapIssuer = "https://cloud.google.com/iap"
	// IAP の署名鍵の配布元。どのプロジェクトの IAP もこの鍵で署名する
	iapJWKSURL = "https://www.gstatic.com/iap/verify/public_key-jwk"
	// IAP と Cloud Run の時計のずれ。exp と iat をこれだけ緩めて見る
	iapClockSkew = 30 * time.Second
)

// ロードバランサーのバックエンド サービスに掛けた IAP の aud の形。
// Terraform で generated_id（数字）の代わりに id（projects/.../backendServices/<名前>）を
// 渡したり、プロジェクト ID と番号を取り違えたりすると、全部のリクエストが 401 になる。
// 起動の時点で気づけるよう、形が違うものはエラーにする。
var iapAudiencePattern = regexp.MustCompile(`^/projects/[0-9]+/global/backendServices/[0-9]+$`)

// IAP が付けてくる JWT（X-Goog-IAP-JWT-Assertion）を検証する。
//
// 本番の POS は Google Cloud の外部 HTTPS ロードバランサーの後ろにあり、そのバックエンド
// サービスに IAP を掛けてログインさせる。IAP を通ったリクエストには IAP が署名した JWT が
// 付く。ロードバランサーや IAP の設定を誤ったとき（IAP を外した・Cloud Run の URL を直接
// 叩ける ingress にした など）にも API が開かないよう、ここでも署名・発行元・audience・
// 期限を確かめ、IAP を通ってきたものだけを受け付ける。
//
// X-Goog-Authenticated-User-Email にもメールが入ってくるが、署名が無く誰でも付けられる
// ので見ない。相手は JWT の email クレームで決める。
//
// 鍵は gstatic から取る。IAP は鍵を替えるが、知らない kid のトークンが来たら取り直す
// ので追従する。
type IAPVerifier struct {
	verifier  *oidc.IDTokenVerifier
	audiences []string
}

// audiences は IAP を掛けたバックエンド サービスの
// /projects/<プロジェクト番号>/global/backendServices/<バックエンド サービスの ID>。
// API へ来る経路が複数のバックエンド サービスに分かれるときのため、複数受け付ける。
func NewIAPVerifier(audiences []string) (*IAPVerifier, error) {
	return newIAPVerifier(iapJWKSURL, audiences)
}

// テストでは鍵の配布元を差し替える。本番では環境変数などで変えられないようにしておく
// （変えられると、自分で用意した鍵で署名したトークンを通せてしまう）。
func newIAPVerifier(jwksURL string, audiences []string) (*IAPVerifier, error) {
	if len(audiences) == 0 {
		return nil, errors.New("iap audience is empty")
	}
	for _, aud := range audiences {
		if !iapAudiencePattern.MatchString(aud) {
			return nil, fmt.Errorf("invalid iap audience %q (want /projects/<PROJECT_NUMBER>/global/backendServices/<BACKEND_SERVICE_ID>)", aud)
		}
	}

	// 鍵の取得が詰まっても、リクエストを長く待たせない
	ctx := oidc.ClientContext(context.Background(), &http.Client{Timeout: 5 * time.Second})
	keySet := oidc.NewRemoteKeySet(ctx, jwksURL)

	return &IAPVerifier{
		verifier: oidc.NewVerifier(iapIssuer, keySet, &oidc.Config{
			// IAP は ES256 でしか署名しない。ほかを許すと、公開鍵を HMAC の鍵に
			// 見立てた偽のトークンなどを受け付ける余地ができる
			SupportedSigningAlgs: []string{oidc.ES256},
			// go-oidc の audience の確かめは 1 つの値しか取れないので、下で自分で見る
			SkipClientIDCheck: true,
			// go-oidc の期限の確かめは時計のずれを見込まず iat も見ないので、下で自分で見る
			SkipExpiryCheck: true,
		}),
		audiences: audiences,
	}, nil
}

func (v *IAPVerifier) Header() string {
	return IAPJWTHeader
}

func (v *IAPVerifier) Verify(ctx context.Context, token string) (AccessIdentity, error) {
	if token == "" {
		return AccessIdentity{}, ErrInvalidAccessToken
	}

	// 署名・アルゴリズム・iss はここで確かめる
	idToken, err := v.verifier.Verify(ctx, token)
	if err != nil {
		return AccessIdentity{}, fmt.Errorf("%w: %v", ErrInvalidAccessToken, err)
	}

	if !slices.ContainsFunc(idToken.Audience, func(aud string) bool { return slices.Contains(v.audiences, aud) }) {
		return AccessIdentity{}, fmt.Errorf("%w: unexpected audience %q", ErrInvalidAccessToken, idToken.Audience)
	}

	// exp・iat の無いトークンはゼロの時刻になり、ここで弾かれる
	now := time.Now()
	if !now.Before(idToken.Expiry.Add(iapClockSkew)) {
		return AccessIdentity{}, fmt.Errorf("%w: expired at %v", ErrInvalidAccessToken, idToken.Expiry)
	}
	if idToken.IssuedAt.IsZero() || idToken.IssuedAt.After(now.Add(iapClockSkew)) {
		return AccessIdentity{}, fmt.Errorf("%w: issued at %v", ErrInvalidAccessToken, idToken.IssuedAt)
	}

	var claims struct {
		Email string `json:"email"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return AccessIdentity{}, fmt.Errorf("%w: %v", ErrInvalidAccessToken, err)
	}
	if strings.TrimSpace(claims.Email) == "" {
		return AccessIdentity{}, fmt.Errorf("%w: no email", ErrInvalidAccessToken)
	}
	return AccessIdentity{Email: claims.Email}, nil
}
