import { type CaosOutboxEntry, jstClock } from "@cafeore/common";
import { ChevronDown, X } from "lucide-react";
import type React from "react";
import { useRef, useState } from "react";
import { TwoStepButton } from "~/components/molecules/TwoStepButton";
import { Button } from "~/components/ui/button";
import { usePanelOutsidePress } from "../hooks/useOutsidePress";

/**
 * この端末のまだ送れていない盤面の操作（ヘッダーの下の「未送信 N 件」）。押すと一覧を開き、1 件ずつ（×）か全部（2 回押し）消せる。
 * 消した操作は送らず、盤面はサーバーの今に戻る。今送っている途中のもの（sending。もうサーバーに届いているかもしれない）は消せず「送信中」と出す。
 * 一覧は外を押すと閉じる。残りが無ければ何も出さない
 */
export const UnsentOps: React.FC<{
  entries: readonly CaosOutboxEntry[];
  sending: string | null;
  failure?: string | null;
  onRetry: () => void;
  onDiscard: (ids: readonly string[]) => void;
}> = ({ entries, sending, failure, onRetry, onDiscard }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const shown = open && entries.length > 0;
  usePanelOutsidePress(ref, () => setOpen(false), shown);
  if (entries.length === 0) return null;
  const removable = entries.filter((entry) => entry.id !== sending);
  return (
    <div ref={ref} className="flex flex-col items-stretch gap-1">
      <div className="flex items-center justify-end gap-2 whitespace-nowrap font-bold text-red-600">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-h-[36px] touch-manipulation items-center gap-1"
        >
          未送信 {entries.length} 件
          <ChevronDown
            className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          もう一度送る
        </Button>
      </div>
      {failure && (
        <p role="alert" className="max-w-[340px] text-red-700 text-xs">
          DB未保存：{failure}。操作は端末に残し、自動で再送します。
        </p>
      )}
      {shown && (
        <div className="w-[340px]">
          <ul className="max-h-[50vh] overflow-y-auto border-slate-200 border-t">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-2 border-slate-100 border-b py-0.5"
              >
                <span className="shrink-0 font-mono text-[12px] text-slate-500">
                  {jstClock(entry.at)}
                </span>
                <span className="min-w-0 flex-1 truncate font-bold text-[13px] text-slate-900">
                  {entry.label}
                </span>
                {entry.id === sending ? (
                  <span className="flex h-10 shrink-0 items-center font-bold text-[11px] text-slate-500">
                    送信中
                  </span>
                ) : (
                  <button
                    type="button"
                    aria-label={`「${entry.label}」を消す`}
                    onClick={() => onDiscard([entry.id])}
                    className="flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full text-slate-500 active:bg-slate-200"
                  >
                    <X className="h-5 w-5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-1 font-bold text-[11px] text-slate-500">
            消した操作は送らず、盤面はサーバーの今に戻ります
          </p>
          {removable.length > 0 && (
            <TwoStepButton
              label={
                removable.length < entries.length
                  ? "送信中のほかを全部消す"
                  : "全部消す"
              }
              confirmLabel="もう一度押すと消す"
              onConfirm={() => onDiscard(removable.map((entry) => entry.id))}
              className="mt-1 mb-1"
            />
          )}
        </div>
      )}
    </div>
  );
};
