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

// JWT を確かめるもの。Cloudflare Access（cloudflare_access.go）と IAP（iap.go）。
type identityVerifier interface {
	// JWT が載ってくるヘッダーの名前
	Header() string
	Verify(ctx context.Context, token string) (AccessIdentity, error)
}

// Access か IAP を通ってきた相手を、メール（Access のサービストークンならクライアント ID）の
// 許可リストで権限に振り分ける。許可リストにはメールのドメイン（*@<ドメイン>）も書ける。
//
// Access や IAP のポリシーでもログインできる人を絞るが、そちらを緩めすぎたとき
// （誰でもワンタイム PIN でログインできる設定など）にも API が開かないよう、
// ここでも許可リストに無い相手は 403 にする。
type Authorizer struct {
	// AUTH_MODE で並べた方式の検証器。それぞれが自分のヘッダーの JWT を確かめる
	verifiers []identityVerifier
	// 名指しで書いた相手（メールか、サービストークンのクライアント ID）
	roles map[string]Role
	// *@<ドメイン> で書いたドメイン。メールにだけ効き、名指しの方が優先する
	domains map[string]Role
	// false なら弾かずにログにだけ出す（AUTH_MODE の -report-only）
	enforce bool
}

// verifiers のヘッダーに付いている JWT を確かめ、その相手を許可リストで振り分ける
// （どのヘッダーを確かめるかは identify）。
//
// staff と viewers の要素は、名指し（メールかサービストークンのクライアント ID）か、
// *@<ドメイン>（そのドメインのメールの全員）。決まりは role を参照。* を含むのに
// *@<ドメイン> の形でない要素はエラーにする。
func NewAuthorizer(staff, viewers []string, verifiers ...identityVerifier) (*Authorizer, error) {
	a := &Authorizer{
		verifiers: verifiers,
		roles:     make(map[string]Role, len(staff)+len(viewers)),
		domains:   map[string]Role{},
		enforce:   true,
	}
	// 両方に書かれていたら強い方を取る（後に入れる staff で上書きする）
	for _, list := range []struct {
		names []string
		role  Role
	}{{viewers, RoleViewer}, {staff, RoleStaff}} {
		for _, name := range list.names {
			name = normalizeName(name)
			domain, isDomain, err := allowListDomain(name)
			switch {
			case err != nil:
				return nil, err
			case isDomain:
				a.domains[domain] = list.role
			case name != "":
				a.roles[name] = list.role
			}
		}
	}
	return a, nil
}

// メールアドレスは大文字・小文字を区別しない扱いにする
func normalizeName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}

// 許可リストの要素（normalizeName 済み）が *@<ドメイン> なら、そのドメインを返す。
// * を含むのにその形でないもの（*、*@、*foo@x、foo*@x、*@*.x、ドメインに @ や空白を
// 含むものなど）は、書き方の誤りで思わぬ相手を通したり誰も通さなくなったりしないよう、
// エラーにする（起動を止める）。
func allowListDomain(entry string) (domain string, ok bool, err error) {
	if !strings.Contains(entry, "*") {
		return "", false, nil
	}
	domain, found := strings.CutPrefix(entry, "*@")
	if !found || !validDomain(domain) {
		return "", false, fmt.Errorf("invalid allow list entry %q (want an email address or *@<domain>)", entry)
	}
	return domain, true, nil
}

// 英小文字・数字・- のラベルを . でつないだものか。
func validDomain(domain string) bool {
	if domain == "" {
		return false
	}
	for _, label := range strings.Split(domain, ".") {
		if label == "" {
			return false
		}
		for _, r := range label {
			if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' {
				return false
			}
		}
	}
	return true
}

// AUTH_MODE で + で並べられる方式。
const (
	methodCloudflareAccess = "cloudflare-access"
	methodIAP              = "iap"
)

const reportOnlySuffix = "-report-only"

// 環境変数から組み立てる。AUTH_MODE が空か off なら nil を返す（認証しない）。
//
//	AUTH_MODE             … off | cloudflare-access | iap | cloudflare-access+iap
//	                        （off 以外は後ろに -report-only を付けられる）
//	CF_ACCESS_TEAM_DOMAIN … Zero Trust のチームのドメイン（<team>.cloudflareaccess.com）
//	CF_ACCESS_AUD         … Access のアプリケーションの AUD タグ
//	IAP_AUDIENCE          … IAP の JWT の aud（/projects/<番号>/global/backendServices/<ID>）。カンマ区切り
//	AUTH_STAFF_EMAILS     … 何でもできる相手。カンマ区切り
//	AUTH_VIEWER_EMAILS    … 読むだけの相手。カンマ区切り
//
// 許可リストの要素には、名指しのほかに *@<ドメイン>（そのドメインのメールの全員）も
// 書ける（role を参照）。
//
// cloudflare-access は Cloudflare Access の JWT（Cf-Access-Jwt-Assertion）を、iap は
// GCP の IAP の JWT（X-Goog-Iap-Jwt-Assertion）を確かめる。+ で並べると（順は問わない）
// どちらを通ってきたものも受け付ける。POS を Workers の Access から GCP の LB の IAP へ
// 移す途中は、両方の道からリクエストが来るのでこれを使う。CF_ACCESS_* は cloudflare-access を、
// IAP_AUDIENCE は iap を含むときだけ要る。許可リストはどの方式でも同じものを使う。
//
// -report-only は並べた方式の全部に掛かり、同じように確かめるが弾かず、弾くはずだった
// ものをログに出すだけにする。切り替える前に本番で流し、POS の通信が全部 Access か IAP を
// 通ってきていること（WebSocket も）と、Cloud Run を直接叩いているものが残っていない
// ことを確かめるために使う。
//
// 綴りの誤りで認証が外れないよう、知らない AUTH_MODE（知らない方式・同じ方式の重複・
// 空の方式を含む）と設定の漏れはエラーにする（main が起動を止める）。
func AuthorizerFromEnv(getenv func(string) string) (*Authorizer, error) {
	mode := strings.TrimSpace(getenv("AUTH_MODE"))
	if mode == "" || mode == "off" {
		return nil, nil
	}
	methods, reportOnly, err := parseAuthMode(mode)
	if err != nil {
		return nil, err
	}

	// 並べた順によらず、いつも Access、IAP の順に確かめる
	var verifiers []identityVerifier
	if methods[methodCloudflareAccess] {
		verifier, err := NewAccessVerifier(getenv("CF_ACCESS_TEAM_DOMAIN"), strings.TrimSpace(getenv("CF_ACCESS_AUD")))
		if err != nil {
			return nil, err
		}
		verifiers = append(verifiers, verifier)
	}
	if methods[methodIAP] {
		verifier, err := NewIAPVerifier(splitList(getenv("IAP_AUDIENCE")))
		if err != nil {
			return nil, err
		}
		verifiers = append(verifiers, verifier)
	}

	staff := splitList(getenv("AUTH_STAFF_EMAILS"))
	if len(staff) == 0 {
		return nil, errors.New("AUTH_STAFF_EMAILS is empty: nobody could write")
	}

	authz, err := NewAuthorizer(staff, splitList(getenv("AUTH_VIEWER_EMAILS")), verifiers...)
	if err != nil {
		return nil, fmt.Errorf("AUTH_STAFF_EMAILS / AUTH_VIEWER_EMAILS: %w", err)
	}
	authz.enforce = !reportOnly
	return authz, nil
}

// AUTH_MODE（off 以外）を、確かめる方式と report-only かどうかに分ける。
// -report-only は最後に 1 つだけ付けられ、並べた方式の全部に掛かる。
func parseAuthMode(mode string) (methods map[string]bool, reportOnly bool, err error) {
	base, reportOnly := strings.CutSuffix(mode, reportOnlySuffix)
	methods = map[string]bool{}
	for _, method := range strings.Split(base, "+") {
		switch method {
		case methodCloudflareAccess, methodIAP:
		default:
			return nil, false, fmt.Errorf("unknown AUTH_MODE %q (want off, or %s, %s or %s+%s optionally followed by %s)",
				mode, methodCloudflareAccess, methodIAP, methodCloudflareAccess, methodIAP, reportOnlySuffix)
		}
		if methods[method] {
			return nil, false, fmt.Errorf("AUTH_MODE %q lists %s twice", mode, method)
		}
		methods[method] = true
	}
	return methods, reportOnly, nil
}

// 弾かずにログにだけ出す設定か。
func (a *Authorizer) ReportOnly() bool {
	return a != nil && !a.enforce
}

// JWT を見るヘッダー。確かめる順に並ぶ。
func (a *Authorizer) Headers() []string {
	if a == nil {
		return nil
	}
	headers := make([]string, 0, len(a.verifiers))
	for _, v := range a.verifiers {
		headers = append(headers, v.Header())
	}
	return headers
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
		identity, err = a.identify(c.Request)
		if err != nil {
			// トークンそのものはログに出さない
			a.reject(c, http.StatusUnauthorized, err.Error())
			return
		}
		c.Set(IdentityContextKey, identity)
	}

	if a.role(identity) < min {
		a.reject(c, http.StatusForbidden, fmt.Sprintf("%q is not allowed", identity.Name()))
		return
	}

	c.Next()
}

// リクエストに付いているヘッダーの JWT を、そのヘッダーの検証器で確かめて相手を返す。
// どの検証器のヘッダーも付いていなければエラー（401）。AUTH_MODE に無い方式の
// ヘッダー（cloudflare-access のときの X-Goog-Iap-Jwt-Assertion など）は見ない。
//
// ふつうは 1 つだけ付いている（Access と IAP は自分のヘッダーしか付けない）。2 つとも
// 付いていたら（cloudflare-access+iap で、誰かが手でもう一方を足したときなど）、両方を
// 確かめ、1 つでも正しくなければ 401 にし、両方正しければ弱い方の権限の相手として扱う。
// こうすると、正しい JWT を 1 つ持っている相手が、それだけを付けて送ったときより強い
// 権限を得ることはなく、もう一方に入った壊れた・偽の JWT が黙って見逃されることもない
// （report-only ならログに出る）。どちらか一方が正しければ通す、にはしない。
//
// 同じヘッダーが 2 つ以上付いていたら、どれを信じるか決められないので正しくないものとして扱う。
func (a *Authorizer) identify(r *http.Request) (AccessIdentity, error) {
	var (
		weakest AccessIdentity
		found   bool
	)
	for _, v := range a.verifiers {
		tokens := r.Header.Values(v.Header())
		switch len(tokens) {
		case 0:
			continue
		case 1:
		default:
			return AccessIdentity{}, fmt.Errorf("%s: %d values", v.Header(), len(tokens))
		}

		identity, err := v.Verify(r.Context(), tokens[0])
		if err != nil {
			return AccessIdentity{}, fmt.Errorf("%s: %w", v.Header(), err)
		}
		if !found || a.role(identity) < a.role(weakest) {
			weakest = identity
		}
		found = true
	}
	if !found {
		return AccessIdentity{}, fmt.Errorf("no token in %s", strings.Join(a.Headers(), " or "))
	}
	return weakest, nil
}

// 許可リストでの権限。載っていなければ RoleNone。
//
// 名指しの行があれば、ドメインの行より優先する。AUTH_STAFF_EMAILS=*@id.cafeore.cafe、
// AUTH_VIEWER_EMAILS=callscreen@id.cafeore.cafe なら、callscreen@ は表示用で、ほかの
// id.cafeore.cafe の人はスタッフ。ドメインはメールの @ より後ろ全体と比べるので、
// サブドメイン（foo@x.id.cafeore.cafe）は一致しない。サービストークンのクライアント ID
// （common_name）はメールではないので、ドメインでは一致させない。
func (a *Authorizer) role(identity AccessIdentity) Role {
	if role, ok := a.roles[normalizeName(identity.Name())]; ok {
		return role
	}
	at := strings.LastIndex(identity.Email, "@")
	if at < 0 {
		return RoleNone
	}
	return a.domains[normalizeName(identity.Email[at+1:])]
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
