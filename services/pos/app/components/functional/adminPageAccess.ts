import type { Permission } from "./usePermission";

/**
 * 管理者だけが開けるページを開けるか
 * - allow: 開ける
 * - checking: /api/me に聞いている
 * - error: /api/me に聞けなかった
 * - expired: ログイン（IAP のセッション）が切れている
 * - deny: 管理者ではない
 */
export type AdminPageAccess =
  | "allow"
  | "checking"
  | "error"
  | "expired"
  | "deny";

type Input = {
  /** /api/me に聞くか（SHOULD_FETCH_PERMISSION）。ローカルでは聞かない */
  shouldFetch: boolean;
  /** /api/me の結果。聞いている間は undefined */
  permission: Permission | undefined;
  /** /api/me に聞けなかったときのエラー */
  error: unknown;
  /** 開くのに必要な最低権限。省略時は管理者だけ */
  minimumRole?: "admin" | "staff";
};

/**
 * 指定した最低権限以上だけが開けるページを開けるか決める
 *
 * 弾くのは、API が弾く設定（enforcement が enforce）のときだけ。off と report-only では
 * API が誰の操作も通すので、画面でも弾かない。画面で弾くのは開かせないためだけで、
 * 権限が必要な操作は API も弾く
 */
export const adminPageAccess = ({
  shouldFetch,
  permission,
  error,
  minimumRole = "admin",
}: Input): AdminPageAccess => {
  // ローカルにはログインが無く、権限も聞かない
  if (!shouldFetch) {
    return "allow";
  }
  // 前に聞けた結果があれば、聞き直しに失敗してもそれで決める（開いているページを消さない）
  if (permission === undefined) {
    return error ? "error" : "checking";
  }
  if (permission.status === "expired") {
    return "expired";
  }
  // 弾く設定で、許可リストに無い相手
  if (permission.status === "forbidden") {
    return "deny";
  }
  if (permission.me.enforcement !== "enforce") {
    return "allow";
  }
  return permission.me.role === "admin" ||
    (minimumRole === "staff" && permission.me.role === "staff")
    ? "allow"
    : "deny";
};
