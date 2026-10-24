// api/internal/auth/authorizer.go
package auth

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// API を叩く相手の権限。上のものほど強く、下の権限でできることは全部できる。
type Role int

const (
	RoleNone Role = iota
	// 読むだけ。呼び出し画面（callscreen）など、表示だけする端末
	RoleViewer
	// 何でもできる。レジ・マスター・提供など、スタッフが操作する端末
	RoleStaff
)

// gin.Context に Access か IAP を通ってきた相手（AccessIdentity）を置くキー。
const IdentityContextKey = "auth.identity"

// report-only で、このリクエストをもうログに出したか。二重に掛けたミドルウェアで
// 同じリクエストを何度も出さないため。
const reportedContextKey = "auth.reported"

type identityVerifier interface {
	// JWT が載ってくるヘッダー。Access と IAP で違う
	Header() string
	Verify(ctx context.Context, token string) (AccessIdentity, error)
}

// Access か IAP を通ってきた相手を、メール（サービストークンならクライアント ID）の
// 許可リストで権限に振り分ける。
//
// Access のポリシーや IAP の IAM でもログインできる人を絞るが、そちらを緩めすぎたとき
// （誰でもワンタイム PIN でログインできる設定・allUsers に権限を付けた など）にも
// API が開かないよう、ここでも許可リストに無い相手は 403 にする。
type Authorizer struct {
	verifier identityVerifier
	roles    map[string]Role
	// false なら弾かずにログにだけ出す（AUTH_MODE=*-report-only）
	enforce bool
}

func NewAuthorizer(verifier identityVerifier, staff, viewers []string) *Authorizer {
	roles := make(map[string]Role, len(staff)+len(viewers))
	for _, name := range viewers {
		roles[normalizeName(name)] = RoleViewer
	}
	// 両方に書かれていたら強い方を取る
	for _, name := range staff {
		roles[normalizeName(name)] = RoleStaff
	}
	delete(roles, "")
	return &Authorizer{verifier: verifier, roles: roles, enforce: true}
}

// メールアドレスは大文字・小文字を区別しない扱いにする
func normalizeName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// 環境変数から組み立てる。AUTH_MODE が空か off なら nil を返す（認証しない）。
//
//	AUTH_MODE             … off | cloudflare-access | cloudflare-access-report-only | iap | iap-report-only
//	CF_ACCESS_TEAM_DOMAIN … Zero Trust のチームのドメイン（<team>.cloudflareaccess.com）
//	CF_ACCESS_AUD         … Access のアプリケーションの AUD タグ
//	IAP_AUDIENCE          … IAP を掛けたバックエンド サービスの aud。カンマ区切り
//	                        （/projects/<プロジェクト番号>/global/backendServices/<バックエンド サービスの ID>）
//	AUTH_STAFF_EMAILS     … 何でもできる相手。カンマ区切り
//	AUTH_VIEWER_EMAILS    … 読むだけの相手。カンマ区切り
//
// CF_ACCESS_* は cloudflare-access*、IAP_AUDIENCE は iap* のときだけ見る。
//
// *-report-only は、それぞれ同じように確かめるが弾かず、弾くはずだったものをログに
// 出すだけにする。切り替える前に本番で流し、POS の通信が全部 Access や IAP を通って
// きていること（WebSocket も）と、Cloud Run を直接叩いているものが残っていないことを
// 確かめるために使う。
//
// 綴りの誤りで認証が外れないよう、知らない AUTH_MODE と設定の漏れはエラーにする
// （main が起動を止める）。
func AuthorizerFromEnv(getenv func(string) string) (*Authorizer, error) {
	mode := strings.TrimSpace(getenv("AUTH_MODE"))
	var verifier identityVerifier
	var err error
	switch mode {
	case "", "off":
		return nil, nil
	case "cloudflare-access", "cloudflare-access-report-only":
		verifier, err = NewAccessVerifier(getenv("CF_ACCESS_TEAM_DOMAIN"), strings.TrimSpace(getenv("CF_ACCESS_AUD")))
	case "iap", "iap-report-only":
		verifier, err = NewIAPVerifier(splitList(getenv("IAP_AUDIENCE")))
	default:
		return nil, fmt.Errorf("unknown AUTH_MODE %q (want off, cloudflare-access, cloudflare-access-report-only, iap or iap-report-only)", mode)
	}
	if err != nil {
		return nil, err
	}
	staff := splitList(getenv("AUTH_STAFF_EMAILS"))
	if len(staff) == 0 {
		return nil, errors.New("AUTH_STAFF_EMAILS is empty: nobody could write")
	}

	authz := NewAuthorizer(verifier, staff, splitList(getenv("AUTH_VIEWER_EMAILS")))
	authz.enforce = !strings.HasSuffix(mode, "-report-only")
	return authz, nil
}

// 弾かずにログにだけ出す設定か。
func (a *Authorizer) ReportOnly() bool {
	return a != nil && !a.enforce
}

func splitList(s string) []string {
	var result []string
	for _, v := range strings.Split(s, ",") {
		if v = strings.TrimSpace(v); v != "" {
			result = append(result, v)
		}
	}
	return result
}

// min 以上の権限を持つ相手だけを通す。a が nil（認証しない設定）なら全部通す。
//
// トークンが無い・正しくないときは 401、正しいが許可リストに無い・権限が
// 足りないときは 403。
func (a *Authorizer) Require(min Role) gin.HandlerFunc {
	if a == nil {
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) { a.check(c, min) }
}

// GET と HEAD は RoleViewer、それ以外は RoleStaff を求める。/api のグループ全体に
// 掛けておけば、ルートを足すたびに権限を書き忘れても書き込みは開かない。
func (a *Authorizer) RequireByMethod() gin.HandlerFunc {
	if a == nil {
		return func(c *gin.Context) { c.Next() }
	}
	return func(c *gin.Context) {
		min := RoleStaff
		if c.Request.Method == http.MethodGet || c.Request.Method == http.MethodHead {
			min = RoleViewer
		}
		a.check(c, min)
	}
}

func (a *Authorizer) check(c *gin.Context, min Role) {
	if c.GetBool(reportedContextKey) {
		c.Next()
		return
	}

	// 外側のミドルウェアで確かめ済みなら、JWT を検証し直さない
	v, _ := c.Get(IdentityContextKey)
	identity, ok := v.(AccessIdentity)
	if !ok {
		var err error
		identity, err = a.verifier.Verify(c.Request.Context(), c.GetHeader(a.verifier.Header()))
		if err != nil {
			// トークンそのものはログに出さない
			a.reject(c, http.StatusUnauthorized, err.Error())
			return
		}
		c.Set(IdentityContextKey, identity)
	}

	if role := a.roles[normalizeName(identity.Name())]; role < min {
		a.reject(c, http.StatusForbidden, fmt.Sprintf("%q is not allowed", identity.Name()))
		return
	}

	c.Next()
}

func (a *Authorizer) reject(c *gin.Context, status int, reason string) {
	if !a.enforce {
		log.Printf("auth(report-only): would reject %s %s with %d: %s", c.Request.Method, c.FullPath(), status, reason)
		c.Set(reportedContextKey, true)
		c.Next()
		return
	}

	log.Printf("auth: %s %s: %s", c.Request.Method, c.FullPath(), reason)
	message := "unauthorized"
	if status == http.StatusForbidden {
		message = "forbidden"
	}
	c.AbortWithStatusJSON(status, gin.H{"error": message})
}
