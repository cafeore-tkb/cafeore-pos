import useSWR from "swr";
import {
  IS_PREVIEW,
  type Permission,
  SHOULD_FETCH,
  SHOULD_FETCH_PERMISSION,
  usePermission,
} from "~/components/functional/usePermission";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

// 画面のサーバー（server/app.ts。Workers なら worker/index.ts）が、IAP がログインさせた相手の
// メールを返す。API（VITE_API_BASE_URL）ではなく、画面と同じオリジンに聞く
const LOGIN_USER_PATH = "/auth/me";

// IAP の決まったクエリ。IAP が自分の cookie を消して、トップページを開き直す。開き直すと IAP が
// また Google のログインを求める。Google アカウントのログインまでは消さないので、ブラウザーが
// Google に 1 つのアカウントでしかログインしていなければ、何も聞かれずに同じアカウントで戻ってくる
const LOGOUT_URL = "/?gcp-iap-mode=CLEAR_LOGIN_COOKIE";

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

type Badge = { label: string; title: string; className: string };

const ROLE_BADGE = {
  admin: {
    label: "管理者",
    title: "すべての操作と、データのリセットができる",
    className: "bg-stone-800 text-white",
  },
  staff: {
    label: "スタッフ",
    title: "すべての操作ができる",
    className: "bg-theme-primary text-white",
  },
  viewer: {
    label: "閲覧のみ",
    title: "見るだけ。注文などの操作はできない",
    className: "bg-stone-600 text-white",
  },
  none: {
    label: "権限なし",
    title: "API の許可リストに無い",
    className: "bg-red-700 text-white",
  },
} satisfies Record<string, Badge>;

const permissionBadge = (
  permission: Permission | undefined,
  error: unknown,
): Badge | null => {
  if (error) {
    return {
      label: "権限を取得できません",
      title: "/api/me に聞けなかった",
      className: "border text-muted-foreground",
    };
  }
  if (permission === undefined) {
    return {
      label: "権限を確認中…",
      title: "",
      className: "border text-muted-foreground",
    };
  }
  if (permission.status === "forbidden") {
    return ROLE_BADGE.none;
  }
  // ログインが切れているのはメールの方に出す
  if (permission.status === "expired") {
    return null;
  }
  const { enforcement, role } = permission.me;
  if (enforcement === "off" || role === null) {
    return {
      label: "権限の確認なし",
      title:
        "API が相手を確かめていない（AUTH_MODE=off）。誰でもすべての操作ができる",
      className: "bg-amber-500 text-white",
    };
  }
  const badge = ROLE_BADGE[role];
  if (enforcement === "report-only") {
    return {
      ...badge,
      label: `${badge.label}（report-only）`,
      title: `${badge.title}。ただし API はまだ弾かない（AUTH_MODE=*-report-only）`,
    };
  }
  return badge;
};

/**
 * ログインしている Google アカウントと、その権限、ログアウトのボタン。PR のプレビューでは「プレビュー」と出す
 */
export function LoginUser() {
  const login = useSWR(SHOULD_FETCH ? "auth/me" : null, fetchLoginUser);
  const permission = usePermission();

  const badge = SHOULD_FETCH_PERMISSION
    ? permissionBadge(permission.data, permission.error)
    : null;

  // PR のプレビューにはログインが無いので、相手の代わりに「プレビュー」と出す。
  // API は管理者 preview としてログインした扱いなので、権限は「管理者」になる（AUTH_PREVIEW_ADMIN）
  if (IS_PREVIEW) {
    return (
      <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
        <span className="text-muted-foreground text-xs">ログイン中</span>
        <span className="rounded-full bg-amber-500 px-2 py-0.5 font-bold text-white text-xs">
          プレビュー
        </span>
        {badge && (
          <span
            title={badge.title}
            className={cn(
              "rounded-full px-2 py-0.5 font-medium text-xs",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        )}
      </div>
    );
  }

  const email = login.data?.status === "ok" ? login.data.email : null;
  // API が確かめた相手が、画面のログインと違う（ログアウトしても API の方の IAP の cookie が
  // 残っていた、など）。出している権限は API の方の相手のもの
  const apiEmail =
    permission.data?.status === "ok" ? permission.data.me.email : null;
  const mismatch =
    email !== null &&
    apiEmail !== null &&
    email.toLowerCase() !== apiEmail.toLowerCase();

  return (
    <div className="space-y-1 rounded-lg border px-3 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-muted-foreground text-xs">ログイン中</span>
        <span className="break-all font-medium">
          {loginLabel(login.data, login.error)}
        </span>
        {badge && (
          <span
            title={badge.title}
            className={cn(
              "rounded-full px-2 py-0.5 font-medium text-xs",
              badge.className,
            )}
          >
            {badge.label}
          </span>
        )}
        {email && (
          <a
            href={LOGOUT_URL}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            ログアウト
          </a>
        )}
      </div>
      {mismatch && (
        <p className="break-all text-red-700 text-xs">
          API には {apiEmail} として届いています（権限はこのアカウントのもの）
        </p>
      )}
    </div>
  );
}
