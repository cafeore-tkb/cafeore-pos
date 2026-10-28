package auth

import "context"

// PreviewAdminName は、PR のプレビュー（AUTH_PREVIEW_ADMIN=true）で全部のリクエストの相手とする管理者の名前。
// GET /api/me の email にもこれが出る。
const PreviewAdminName = "preview"

// PR のプレビューで、全部のリクエストを管理者 PreviewAdminName がログインしてきたものとして扱う。
// プレビューには Access も IAP も無く、実際にはログインさせない。DB は PR ごとの使い捨てなので、
// 本番と同じ確かめ方（管理者だけのもの・RequireStrict も含めて）のまま、管理者として全部を使えるようにする。
type previewVerifier struct{}

// プレビューでは何も確かめないので、どのヘッダーでもよい（使わない）。
func (previewVerifier) Header() string { return "X-Preview-Admin" }

func (previewVerifier) Verify(context.Context, string) (AccessIdentity, error) {
	return AccessIdentity{CommonName: PreviewAdminName}, nil
}

// newPreviewAuthorizer は、全部のリクエストを管理者 PreviewAdminName として弾く設定（enforce）で確かめる。
func newPreviewAuthorizer() *Authorizer {
	return NewAuthorizer(previewVerifier{}, nil, nil, PreviewAdminName)
}
