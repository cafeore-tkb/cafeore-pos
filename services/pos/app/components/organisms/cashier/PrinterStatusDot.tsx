import { memo } from "react";
import { cn } from "~/lib/utils";
import type { ConnectionIssue } from "../../functional/connectionIssues";

type props = {
  /** どのプリンターか（ラベル・レシート） */
  name: string;
  status: "init" | "disconnected" | "connecting" | "connected";
  /** つながらないときに案内する、端末でプリンターの証明書を許可するページ */
  certificateUrl?: string;
};

const DOT: Record<props["status"], string> = {
  init: "bg-stone-300",
  connecting: "bg-orange-500 animate-pulse",
  connected: "bg-green-600",
  disconnected: "bg-red-600",
};

const TITLE: Record<props["status"], string> = {
  init: "確認中",
  connecting: "接続中",
  connected: "接続完了",
  disconnected: "未接続",
};

/**
 * レジのヘッダーに出す、プリンターがつながっているかの印
 *
 * つながらないときは赤く出し、押すと証明書を許可するページを開く（iPad は一度開いて許可する）。
 */
export const PrinterStatusDot = memo(
  ({ name, status, certificateUrl }: props) => {
    const label = (
      <>
        <span className={cn("h-2 w-2 rounded-full", DOT[status])} />
        {status === "disconnected" ? `${name}未接続` : name}
      </>
    );
    const title = `${name}プリンター${TITLE[status]}`;
    if (status === "disconnected" && certificateUrl) {
      return (
        <a
          href={certificateUrl}
          target="_blank"
          rel="noreferrer"
          title={`${title}。iPad は ${certificateUrl} を一度開いて証明書を許可`}
          className="flex items-center gap-1.5 font-bold text-red-600 underline"
        >
          {label}
        </a>
      );
    }
    return (
      <span
        title={title}
        className={cn(
          "flex items-center gap-1.5",
          status === "disconnected" && "font-bold text-red-600",
          status === "connecting" && "text-orange-600",
        )}
      >
        {label}
      </span>
    );
  },
);

/**
 * レジのヘッダーに出す、つながっていないもの（バックエンド未接続など）。文は title に出す
 */
export const ConnectionIssueDot = ({ issue }: { issue: ConnectionIssue }) => (
  <span
    title={issue.message}
    className={cn(
      "flex items-center gap-1.5 font-bold",
      issue.tone === "error" ? "text-red-600" : "text-orange-600",
    )}
  >
    <span
      className={cn(
        "h-2 w-2 rounded-full",
        issue.tone === "error" ? "bg-red-600" : "animate-pulse bg-orange-500",
      )}
    />
    {issue.label}
  </span>
);
