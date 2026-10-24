import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button, buttonVariants } from "~/components/ui/button";
import { adminPageAccess } from "./adminPageAccess";
import { SHOULD_FETCH, usePermission } from "./usePermission";

// 聞けなかったときは聞き直す。ログインが切れているときは、読み込み直すと IAP がログインへ戻す
const reload = () => window.location.reload();

/**
 * 本番（API が弾く設定）では、管理者にだけ children を出す。ほかの人には children を
 * マウントしない（ページのデータも読まない）。プレビューとローカルではそのまま出す
 *
 * 画面で弾くのは開かせないためだけで、管理者だけの操作は API も弾く
 */
export function AdminOnly({ children }: { children: ReactNode }) {
  // 開いている間に聞き直して、ログイン切れなどでページを消すと入力途中のものも消えるので、
  // 開いたときにだけ聞く
  const permission = usePermission({
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
  });
  const access = adminPageAccess({
    shouldFetch: SHOULD_FETCH,
    permission: permission.data,
    error: permission.error,
  });

  if (access === "allow") {
    return <>{children}</>;
  }

  if (access === "checking") {
    return (
      <Centered>
        <p className="flex items-center text-muted-foreground text-sm">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          権限を確認中…
        </p>
      </Centered>
    );
  }

  if (access === "error" || access === "expired") {
    return (
      <Centered>
        <p className="font-bold">
          {access === "error"
            ? "権限を確認できませんでした"
            : "ログインが切れています"}
        </p>
        <Button type="button" variant="outline" onClick={reload}>
          再読み込み
        </Button>
      </Centered>
    );
  }

  // API が確かめた相手。許可リストに無い（403）ときは分からない
  const email =
    permission.data?.status === "ok" ? permission.data.me.email : null;

  return (
    <Centered>
      <p className="font-bold">このページは管理者だけが開けます</p>
      {email && (
        <p className="break-all text-muted-foreground text-sm">
          ログイン中: {email}
        </p>
      )}
      <Link to="/" className={buttonVariants({ variant: "outline" })}>
        トップページへ戻る
      </Link>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      {children}
    </div>
  );
}
