import useSWR from "swr";
import { TwoStepButton } from "~/components/molecules/TwoStepButton";

// 画面のサーバー（server/app.ts。Workers なら worker/index.ts）が、IAP がログインさせた相手の
// メールを返す。API（VITE_API_BASE_URL）ではなく、画面と同じオリジンに聞く
const LOGIN_USER_PATH = "/auth/me";

// IAP の決まったクエリ。IAP が自分の cookie を消して、トップページを開き直す。開き直すと IAP が
// また Google のログインを求める。Google アカウントのログインまでは消さないので、ブラウザーが
// Google に 1 つのアカウントでしかログインしていなければ、何も聞かれずに同じアカウントで戻ってくる
const LOGOUT_URL = "/?gcp-iap-mode=CLEAR_LOGIN_COOKIE";

// PR のプレビュー（Workers）。ログインが無いので、相手の代わりに「プレビュー」と出す
const IS_PREVIEW = import.meta.env.VITE_BUILD_PREVIEW === "true";

type LoginState =
  // email は、IAP を通っていない（非常用の pos-cf.cafeore.cafe など）なら null
  | { status: "ok"; email: string | null }
  // IAP のセッションが切れている。useOnlineStatus が読み込み直してログインへ戻す
  | { status: "expired" };

const fetchLoginUser = async (): Promise<LoginState> => {
  const response = await fetch(LOGIN_USER_PATH, {
    cache: "no-store",
    // セッションが切れているとき、IAP に Google のログインへ飛ばさせず 401 を返させる
    // （useOnlineStatus と同じ）。同じオリジンなので preflight は要らない
    headers: { "X-Requested-With": "XMLHttpRequest" },
  });
  if (response.status === 401) {
    return { status: "expired" };
  }
  if (!response.ok) {
    throw new Error(`${LOGIN_USER_PATH} failed: ${response.status}`);
  }
  const body: { email?: string | null } = await response.json();
  return { status: "ok", email: body.email || null };
};

const loginLabel = (user: LoginState | undefined, error: unknown): string => {
  if (import.meta.env.DEV) {
    return "ローカル";
  }
  if (error) {
    return "取得できません";
  }
  if (user === undefined) {
    return "確認中…";
  }
  if (user.status === "expired") {
    return "ログインが切れています";
  }
  return user.email ?? "ログインなし";
};

/**
 * ログインしている Google アカウントと、ログアウトのボタン。PR のプレビューでは「プレビュー」と出す
 */
export function LoginUser() {
  // ローカルの dev（react-router dev）には画面のサーバーが無く、何を聞いても index.html が返るので聞かない
  const { data, error } = useSWR(
    IS_PREVIEW || import.meta.env.DEV ? null : "auth/me",
    fetchLoginUser,
  );

  if (IS_PREVIEW) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <span className="text-muted-foreground text-xs">ログイン中</span>
        <span className="rounded-full bg-amber-500 px-2 py-0.5 font-bold text-white text-xs">
          プレビュー
        </span>
      </div>
    );
  }

  const email = data?.status === "ok" ? data.email : null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2 text-sm">
      <span className="text-muted-foreground text-xs">ログイン中</span>
      <span className="break-all font-medium">{loginLabel(data, error)}</span>
      {email && (
        <TwoStepButton
          label="ログアウト"
          confirmLabel="もう一度押すとログアウト"
          onConfirm={() => window.location.assign(LOGOUT_URL)}
          className="w-auto"
        />
      )}
    </div>
  );
}
