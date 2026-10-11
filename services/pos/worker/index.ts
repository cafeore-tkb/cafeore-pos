// POS の Worker。静的ファイル（build/client）は assets がそのまま返し、
// /api・/status・/health だけをここで Cloud Run の API へ中継する。
//
// ## なぜ中継するのか
//
// 本番はこの Worker の URL ごと Cloudflare Access で守る。Access はログインした
// 端末からのリクエストにだけ JWT（Cf-Access-Jwt-Assertion）を付けてここへ渡すので、
// それを API にそのまま渡し、API が検証する（api/internal/auth）。
// ブラウザから Cloud Run を直接呼ぶ形のままだと、Access のログインが API に効かない。
//
// さらに、中継するときに秘密のトークン（PROXY_TOKEN）をヘッダーに付ける。Cloud Run の
// 手前の LB の Cloud Armor がそれを照らし合わせ、合わないものを落とす（infra の
// gcp/api_edge.tf）。JWT は盗まれると Cloud Run に直接使えてしまうが、トークンは
// この Worker の secret にしか無く、ブラウザには出ないので、それを防げる。
//
// どのパスでこの Worker が動くかは wrangler.jsonc の assets.run_worker_first で
// 決めている。それ以外は SPA のフォールバックで index.html が返り、ここには来ない。

interface Env {
  // 中継先の API（Cloud Run）のオリジン。デプロイの workflow が --var で渡す。
  // 無いとき（PR のプレビュー）は中継しない。プレビューのフロントは Cloud Run を直接呼ぶ。
  API_ORIGIN?: string;
  // Cloud Armor と照らし合わせるトークン（wrangler secret put PROXY_TOKEN）。
  // infra の api_proxy_token と同じ値。無いときは付けない（LB を置く前）。
  PROXY_TOKEN?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
}

// run_worker_first と揃えること
const API_PATH = /^\/(?:api\/|status$|health$)/;

// **infra の gcp/api_edge.tf の api_proxy_token_header と揃えること。**
const PROXY_TOKEN_HEADER = "X-Cafeore-Proxy-Token";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!API_PATH.test(url.pathname)) {
      return env.ASSETS.fetch(request);
    }
    if (!env.API_ORIGIN) {
      return Response.json(
        { error: "API_ORIGIN is not configured" },
        { status: 503 },
      );
    }

    const target = new URL(url.pathname + url.search, env.API_ORIGIN);
    const headers = new Headers(request.headers);
    // Access のセッションの cookie（CF_Authorization）は API に渡さない。
    // API が見るのは Access が付けたヘッダーの方だけ。
    headers.delete("cookie");
    // ブラウザが付けてきたものは捨て、こちらの secret で付け直す
    headers.delete(PROXY_TOKEN_HEADER);
    if (env.PROXY_TOKEN) {
      headers.set(PROXY_TOKEN_HEADER, env.PROXY_TOKEN);
    }

    // WebSocket（/api/ws/orders）もこのまま中継できる。Upgrade の応答（101）を
    // 返せば、その後のメッセージは Cloudflare が受け渡す。
    return fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      // API のリダイレクト（末尾の / など）はブラウザに返し、ここでは追わない
      redirect: "manual",
    });
  },
};
