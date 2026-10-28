import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { buttonVariants } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/** トップのどの区分から開くページか */
export type AdminPageGroup = "admin" | "settings" | "exports";

const groupBadge: Record<AdminPageGroup, { label: string; className: string }> =
  {
    // トップの「運営・管理」のカードのバッジと同じ
    admin: {
      label: "運営・管理",
      className: "bg-stone-700 px-2 py-0.5 text-white",
    },
    // 枠線の 1px ぶん余白を詰めて、塗りのバッジと大きさを揃える
    settings: {
      label: "マスタ設定",
      className: "border border-stone-300 px-[7px] py-px text-stone-700",
    },
    exports: {
      label: "データ書き出し",
      className: "border border-stone-300 px-[7px] py-px text-stone-700",
    },
  };

/**
 * 運営・管理のページ（トップから開くページ）の見出し。
 * 戻るボタンは履歴ではなくトップへ移るので、新しいタブや直リンクで開いてもトップへ戻れる。
 * <a> にすると読み込み直しになり、呼び出し画面の CM（このタブの中だけで覚える）が消えるので <Link> で移る
 */
export function AdminPageHeader({
  group,
  title,
  description,
  actions,
  children,
  tone = "default",
}: {
  group: AdminPageGroup;
  title: string;
  description?: ReactNode;
  /** 見出しの行の右端に置くもの */
  actions?: ReactNode;
  /** 説明の下に足すもの */
  children?: ReactNode;
  /** danger は赤い地（データのリセット）に載せる。見出し・バッジ・説明を白っぽい色にする。戻るボタンは白いまま */
  tone?: "default" | "danger";
}) {
  const badge = groupBadge[group];
  const danger = tone === "danger";
  return (
    <header className="flex flex-col gap-3 font-noto">
      <div className="flex flex-wrap items-center gap-4">
        <Link
          to="/"
          className={buttonVariants({
            variant: "outline",
            className: "gap-1 pr-3.5 pl-2.5",
          })}
        >
          <ChevronLeft className="h-4.5 w-4.5" aria-hidden="true" />
          トップへ戻る
        </Link>
        {/* スマホの幅では見出しが次の行に回り、線だけが残るので出さない */}
        <div
          className={cn(
            "hidden h-6 w-px sm:block",
            danger ? "bg-red-300" : "bg-border",
          )}
          aria-hidden="true"
        />
        <h1
          className={cn(
            "font-bold text-2xl tracking-tight",
            danger && "text-white",
          )}
        >
          {title}
        </h1>
        <span
          className={cn(
            "rounded-full font-medium text-xs",
            badge.className,
            danger && "border-red-300 text-white",
          )}
        >
          {badge.label}
        </span>
        {actions && <div className="ml-auto">{actions}</div>}
      </div>
      {description && (
        <p
          className={cn(
            "max-w-[760px] text-pretty text-sm",
            danger ? "text-red-50" : "text-muted-foreground",
          )}
        >
          {description}
        </p>
      )}
      {children}
    </header>
  );
}
