// api/internal/auth/google_id_token.go
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const googleTokenInfoURL = "https://oauth2.googleapis.com/tokeninfo"

// Cloud Scheduler などが付けてくる Google の ID トークン（OIDC）を検証する。
//
// 署名と有効期限の検証は Google の tokeninfo エンドポイントに任せ、ここでは
// 発行元・audience・サービスアカウントが想定どおりかだけを見る。
// 呼ばれるのは数時間に一度なので、毎回問い合わせても負担にならない。
type GoogleIDTokenVerifier struct {
	audience string
	email    string
	endpoint string
	client   *http.Client
}

func NewGoogleIDTokenVerifier(audience, email string) *GoogleIDTokenVerifier {
	return &GoogleIDTokenVerifier{
		audience: audience,
		email:    email,
		endpoint: googleTokenInfoURL,
		client:   &http.Client{Timeout: 5 * time.Second},
	}
}

var ErrInvalidIDToken = errors.New("invalid id token")

type tokenInfo struct {
	Iss           string `json:"iss"`
	Aud           string `json:"aud"`
	Email         string `json:"email"`
	EmailVerified string `json:"email_verified"`
}

func (v *GoogleIDTokenVerifier) Verify(ctx context.Context, token string) error {
	if token == "" {
		return ErrInvalidIDToken
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.endpoint+"?id_token="+url.QueryEscape(token), nil)
	if err != nil {
		return err
	}
	res, err := v.client.Do(req)
	if err != nil {
		return fmt.Errorf("tokeninfo: %w", err)
	}
	defer func() { _ = res.Body.Close() }()

	// 署名が合わない・期限切れのトークンには 400 が返る
	if res.StatusCode != http.StatusOK {
		return ErrInvalidIDToken
	}

	var info tokenInfo
	if err := json.NewDecoder(res.Body).Decode(&info); err != nil {
		return fmt.Errorf("tokeninfo: %w", err)
	}

	switch {
	case info.Iss != "https://accounts.google.com" && info.Iss != "accounts.google.com":
		return ErrInvalidIDToken
	case info.Aud != v.audience:
		return ErrInvalidIDToken
	case info.Email != v.email || info.EmailVerified != "true":
		return ErrInvalidIDToken
	}
	return nil
}
