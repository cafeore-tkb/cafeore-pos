// api/internal/auth/authorizer.go
package auth

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"

	"cafeore-pos/api/internal/models"

	"github.com/gin-gonic/gin"
)

// API を叩く相手の権限。上のものほど強く、下の権限でできることは全部できる。
type Role int

const (
	RoleNone Role = iota
	// 読むだけ。呼び出し画面（callscreen）など、表示だけする端末
	RoleViewer
	// 営業で使うことは何でもできる。レジ・マスター・提供など、スタッフが操作する端末
	RoleStaff
	// スタッフにできることに加えて、営業データのリセットのような取り返しのつかない操作ができる。
	// 運営の数人だけ。ドメインごとには書けない（validateAdminList）
	RoleAdmin
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
//
// 許可リストには、メールアドレス（サービストークンならクライアント ID）のほかに、
// 「@id.cafeore.cafe」のように @ で始めてドメインごと書ける。そのドメインのアカウント
// （今あるものも、これから作るものも）が全部通る。サブドメインは含まない
// （@cafeore.cafe は a@id.cafeore.cafe に当たらない）。
// 1 人が複数の項目に当たるときは強い方を取るので、ドメインで表示用にして、その中の
// 何人かだけをメールでスタッフにはできるが、逆（ドメインでスタッフにして一部を表示用に下げる）はできない。
type Authorizer struct {
	verifier identityVerifier
	// メールアドレス（とクライアント ID）ごと
	roles map[string]Role
	// ドメインごと（@ を除いた小文字）
	domainRoles map[string]Role
	// false なら弾かずにログにだけ出す（AUTH_MODE=*-report-only）
	enforce bool
}

func NewAuthorizer(verifier identityVerifier, staff, viewers []string) *Authorizer {
	authz := &Authorizer{
		verifier:    verifier,
		roles:       make(map[string]Role, len(staff)+len(viewers)),
		domainRoles: map[string]Role{},
		enforce:     true,
	}
	// 両方に書かれていたら強い方を取る
	authz.allow(viewers, RoleViewer)
	authz.allow(staff, RoleStaff)
	delete(authz.roles, "")
	delete(authz.domainRoles, "")
	return authz
}

func (a *Authorizer) allow(names []string, role Role) {
	for _, name := range names {
		name = normalizeName(name)
		target, key := a.roles, name
		if domain, ok := strings.CutPrefix(name, "@"); ok {
			target, key = a.domainRoles, domain
		}
		if target[key] < role {
			target[key] = role
		}
	}
}

// その相手の権限。メールアドレスの項目と、そのドメインの項目の強い方
func (a *Authorizer) role(name string) Role {
	name = normalizeName(name)
	role := a.roles[name]
	// サービストークン（クライアント ID）には @ が無いので、ドメインの項目には当たらない
	if at := strings.LastIndex(name, "@"); at > 0 {
		if domainRole := a.domainRoles[name[at+1:]]; domainRole > role {
			role = domainRole
		}
	}
	return role
}

// ドメインごとの項目の形（@ と、ドットを 1 つ以上含むホスト名）
var allowedDomainPattern = regexp.MustCompile(`^@[a-z0-9-]+(\.[a-z0-9-]+)+$`)

// 許可リストの項目を確かめる。「*@example.com」のようなワイルドカードや、形の崩れた
// ドメインの項目は、どこにも当たらずに黙って誰も通れなくなる（か、意図より広く読まれる）ので、
// 起動を止める。
func validateAllowList(env string, names []string) error {
	for _, name := range names {
		normalized := normalizeName(name)
		switch {
		case strings.ContainsAny(normalized, "* \t"):
			return fmt.Errorf("%s: %q: use an address or @domain (wildcards and spaces are not supported)", env, name)
		case strings.HasPrefix(normalized, "@") && !allowedDomainPattern.MatchString(normalized):
			return fmt.Errorf("%s: %q: a domain entry must look like @example.com", env, name)
		}
	}
	return nil
}

// 管理者の一覧を確かめる。管理者はドメインごとには書けない。ドメインで書くと、そのドメインで
// これから作られるアカウントも全部、営業データを消せるようになってしまうため。
func validateAdminList(env string, names []string) error {
	if err := validateAllowList(env, names); err != nil {
		return err
	}
	for _, name := range names {
		if strings.HasPrefix(normalizeName(name), "@") {
			return fmt.Errorf("%s: %q: write each admin's address (domain entries are not allowed for admins)", env, name)
		}
	}
	return nil
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
//	AUTH_STAFF_EMAILS     … 何でもできる相手。カンマ区切り。@example.com でドメインごと
//	AUTH_VIEWER_EMAILS    … 読むだけの相手。カンマ区切り。@example.com でドメインごと
//	AUTH_ADMIN_EMAILS     … スタッフにできることに加えて、営業データのリセットができる相手。
//	                        カンマ区切り。ドメインごとには書けない。空なら誰もリセットできない
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
	viewers := splitList(getenv("AUTH_VIEWER_EMAILS"))
	if err := validateAllowList("AUTH_STAFF_EMAILS", staff); err != nil {
		return nil, err
	}
	if err := validateAllowList("AUTH_VIEWER_EMAILS", viewers); err != nil {
		return nil, err
	}
	admins := splitList(getenv("AUTH_ADMIN_EMAILS"))
	if err := validateAdminList("AUTH_ADMIN_EMAILS", admins); err != nil {
		return nil, err
	}

	authz := NewAuthorizer(verifier, staff, viewers)
	authz.allow(admins, RoleAdmin)
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

// 呼んだ相手と、その権限を返す（GET /api/me。POS のトップページに出す）。
//
// /api のグループ（RequireByMethod）の中に置き、確かめた相手をそこから受け取る。なので
// 弾く設定なら、権限の無い相手（401・403）はここに来ない。role が none になるのは report-only だけ。
// a が nil（認証しない設定）なら、相手が分からないので email も role も null。
func (a *Authorizer) Me(c *gin.Context) {
	if a == nil {
		c.JSON(http.StatusOK, models.MeResponse{Enforcement: models.MeEnforcementOff})
		return
	}

	res := models.MeResponse{Enforcement: models.MeEnforcementEnforce}
	if !a.enforce {
		res.Enforcement = models.MeEnforcementReportOnly
	}
	role := models.MeRoleNone
	// report-only で JWT が無い・正しくなかったときは、相手が置かれていない
	if v, ok := c.Get(IdentityContextKey); ok {
		name := v.(AccessIdentity).Name()
		res.Email = &name
		switch a.role(name) {
		case RoleAdmin:
			role = models.MeRoleAdmin
		case RoleStaff:
			role = models.MeRoleStaff
		case RoleViewer:
			role = models.MeRoleViewer
		}
	}
	res.Role = &role
	c.JSON(http.StatusOK, res)
}

// AuthDisabledMessage は、認証を掛けていない（AUTH_MODE が off か *-report-only）ので RequireStrict が断るときの文。
const AuthDisabledMessage = "この操作は API の認証（AUTH_MODE=iap か cloudflare-access）が有効なときだけ使えます"

// RequireStrict は、取り返しのつかない操作（営業データのリセット）のためのもの。
// Require と違い、認証を掛けていない設定でも通さない。
//
//   - a が nil（AUTH_MODE=off）なら誰も通さない（403）
//   - *-report-only でも誰も通さない（403）。認証を切り替えている途中（ほかの API はまだ誰でも叩ける）の間は、
//     取り返しのつかない操作を使わせない
func (a *Authorizer) RequireStrict(min Role) gin.HandlerFunc {
	if a == nil {
		return func(c *gin.Context) {
			log.Printf("auth: %s %s: rejected because AUTH_MODE is off", c.Request.Method, c.FullPath())
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": AuthDisabledMessage})
		}
	}
	return func(c *gin.Context) {
		if !a.enforce {
			log.Printf("auth: %s %s: rejected because AUTH_MODE is report-only", c.Request.Method, c.FullPath())
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": AuthDisabledMessage})
			return
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

	if role := a.role(identity.Name()); role < min {
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
