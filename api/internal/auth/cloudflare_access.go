// api/internal/auth/cloudflare_access.go
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
)

// Cloudflare Access がリクエストに付けてくる JWT のヘッダー。
const AccessJWTHeader = "Cf-Access-Jwt-Assertion"

// Cloudflare Access が付けてくる JWT（Cf-Access-Jwt-Assertion）を検証する。
//
// 本番の POS は Cloudflare Workers の上にあり、Worker が /api を Cloud Run へ
// 中継する（services/pos/worker）。Access はその手前でログインさせ、通した
// リクエストにアプリケーション用の JWT を付ける。Cloud Run の URL は誰でも
// 叩けるので、ここで署名・発行元・audience・期限を確かめ、Access を通って
// きたものだけを受け付ける。
//
// 鍵は <チームのドメイン>/cdn-cgi/access/certs から取る。Access は 6 週間ごとに
// 鍵を替えるが、知らない kid のトークンが来たら取り直すので追従する。
type AccessVerifier struct {
	verifier *oidc.IDTokenVerifier
}

// Access（か IAP）を通ってきた相手。人ならメール、Access のサービストークンなら
// クライアント ID が入る。IAP ではメールだけ。
type AccessIdentity struct {
	Email string
	// サービストークン（CF-Access-Client-Id で入ってきたもの）のクライアント ID
	CommonName string
}

// 許可リストと照らし合わせる名前。
func (i AccessIdentity) Name() string {
	if i.Email != "" {
		return i.Email
	}
	return i.CommonName
}

var ErrInvalidAccessToken = errors.New("invalid access token")

// teamDomain は Zero Trust のチームのドメイン（cafeore.cloudflareaccess.com、
// https:// は付けても付けなくてもよい）。audience は Access のアプリケーションの
// Application Audience (AUD) タグ。
func NewAccessVerifier(teamDomain, audience string) (*AccessVerifier, error) {
	issuer, err := normalizeTeamDomain(teamDomain)
	if err != nil {
		return nil, err
	}
	if audience == "" {
		return nil, errors.New("access audience is empty")
	}

	// 鍵の取得が詰まっても、リクエストを長く待たせない
	ctx := oidc.ClientContext(context.Background(), &http.Client{Timeout: 5 * time.Second})
	keySet := oidc.NewRemoteKeySet(ctx, issuer+"/cdn-cgi/access/certs")

	return &AccessVerifier{
		verifier: oidc.NewVerifier(issuer, keySet, &oidc.Config{ClientID: audience}),
	}, nil
}

// JWT の iss はスキーム付き・末尾の / なしの形（https://<team>.cloudflareaccess.com）。
// 書き方の揺れで全部弾かないよう、そこに揃える。
func normalizeTeamDomain(teamDomain string) (string, error) {
	teamDomain = strings.TrimSpace(teamDomain)
	if teamDomain == "" {
		return "", errors.New("access team domain is empty")
	}
	if !strings.Contains(teamDomain, "://") {
		teamDomain = "https://" + teamDomain
	}

	u, err := url.Parse(teamDomain)
	if err != nil || u.Host == "" || (u.Path != "" && u.Path != "/") {
		return "", fmt.Errorf("invalid access team domain %q", teamDomain)
	}
	return u.Scheme + "://" + u.Host, nil
}

func (v *AccessVerifier) Header() string {
	return AccessJWTHeader
}

func (v *AccessVerifier) Verify(ctx context.Context, token string) (AccessIdentity, error) {
	if token == "" {
		return AccessIdentity{}, ErrInvalidAccessToken
	}

	idToken, err := v.verifier.Verify(ctx, token)
	if err != nil {
		return AccessIdentity{}, fmt.Errorf("%w: %v", ErrInvalidAccessToken, err)
	}

	var claims struct {
		Email      string `json:"email"`
		CommonName string `json:"common_name"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return AccessIdentity{}, fmt.Errorf("%w: %v", ErrInvalidAccessToken, err)
	}

	identity := AccessIdentity{Email: claims.Email, CommonName: claims.CommonName}
	if identity.Name() == "" {
		return AccessIdentity{}, fmt.Errorf("%w: neither email nor common_name", ErrInvalidAccessToken)
	}
	return identity, nil
}
