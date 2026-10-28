import { API_BASE_URL, apiClient } from "@cafeore/common";
import useSWR, { type SWRConfiguration } from "swr";

// PR のプレビュー（Workers）。ログインが無い。
// 本番（Cloud Run・pos-cf）の VITE_DEPLOY_ENV は production、staging・sandbox・playground はその名前、ローカルは無い
export const IS_PREVIEW = import.meta.env.VITE_DEPLOY_ENV === "preview";

// ローカルの dev（react-router dev）には画面のサーバーが無く、何を聞いても index.html が返るので聞かない。
// 画面のサーバーに聞くログインのメール（/auth/me）は、ログインの無いプレビューでも聞かない
export const SHOULD_FETCH = !IS_PREVIEW && !import.meta.env.DEV;

// 権限（/api/me）は API に聞くので、プレビューでも聞く。プレビューの API は、全部のリクエストを管理者
// preview がログインしてきたものとして扱う（AUTH_PREVIEW_ADMIN）。ローカルの dev では聞かない
export const SHOULD_FETCH_PERMISSION = !import.meta.env.DEV;

/** API が決めている権限（AUTH_ADMIN_EMAILS・AUTH_STAFF_EMAILS・AUTH_VIEWER_EMAILS）。API の /api/me に聞く */
export const fetchPermission = async () => {
  // 別オリジン（ローカル・プレビュー）に付けると CORS の preflight が要るので、
  // 同じオリジン（本番）のときだけ付ける（useOnlineStatus と同じ）
  const sameOrigin = new URL(API_BASE_URL).origin === window.location.origin;
  const { data, response } = await apiClient.GET("/api/me", {
    cache: "no-store",
    headers: sameOrigin ? { "X-Requested-With": "XMLHttpRequest" } : undefined,
  });
  // 弾く設定（AUTH_MODE=iap）で、許可リストに無い相手
  if (response.status === 403) {
    return { status: "forbidden" } as const;
  }
  if (response.status === 401) {
    return { status: "expired" } as const;
  }
  if (!data) {
    throw new Error(`/api/me failed: ${response.status}`);
  }
  return { status: "ok", me: data } as const;
};

export type Permission = Awaited<ReturnType<typeof fetchPermission>>;

/**
 * API が決めている権限。トップページのログインの表示（LoginUser）と、管理者だけが開けるページ（AdminOnly）で
 * 同じキーを使うので、トップページから開けば聞き直すまでの間も前の結果で決められる。
 * ローカルでは聞かない（data は undefined のまま）
 */
export const usePermission = (config?: SWRConfiguration<Permission>) =>
  useSWR(SHOULD_FETCH_PERMISSION ? "api/me" : null, fetchPermission, config);
