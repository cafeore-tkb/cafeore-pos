import { KeyRound, RefreshCw, Trash2, X } from "lucide-react";
import type React from "react";
import { useState } from "react";
import type { ShiftFeedState } from "./useShiftFeed";

// CaOS の設定：sohosai-shift の合言葉。この iPad にだけ覚えさせる（ビルドには入れない）。
// 合言葉は sohosai-shift で CaOS へ配信したときのもの。無くても交代（名前の自由入力）は使える。

const formatDateTime = (value: string | number | null) => {
  if (value === null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const maskKey = (key: string) =>
  key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "保存済み";

interface ShiftFeedSettingsProps {
  shiftFeed: ShiftFeedState;
  onClose: () => void;
}

export const ShiftFeedSettings: React.FC<ShiftFeedSettingsProps> = ({
  shiftFeed,
  onClose,
}) => {
  const { feedKey, feed, loading, error, fetchedAt } = shiftFeed;
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const status = !feedKey
    ? { tone: "slate", text: "合言葉を入れていません（名前の候補は出ません）" }
    : loading && !feed
      ? { tone: "slate", text: "読んでいます…" }
      : error
        ? {
            tone: "red",
            text: feed
              ? `読み直せません：${error}（前に読んだ予定を使っています）`
              : `読めません：${error}`,
          }
        : feed
          ? { tone: "emerald", text: "読めました" }
          : { tone: "slate", text: "まだ読んでいません" };

  return (
    <div
      className="fixed inset-0 z-[205] flex items-center justify-center bg-slate-950/40 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="sohosai-shift の合言葉"
        className="w-[min(520px,100%)] overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-slate-200 border-b bg-slate-50 px-5 py-3">
          <h2 className="flex items-center gap-1.5 font-black text-[18px] text-slate-950">
            <KeyRound className="h-5 w-5" />
            sohosai-shift の合言葉
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full hover:bg-slate-200"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="space-y-4 p-5">
          <section>
            <p className="text-[12px] text-slate-500 leading-relaxed">
              sohosai-shift で CaOS
              へ配信したときの合言葉です。この端末にだけ覚えさせます。交代のときの名前の候補と、上級生（限定を淹れられる人）の判定に使います。予定どおりに自動で交代はしません。
            </p>
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const message = shiftFeed.saveKey(input);
                setInputError(message);
                if (!message) setInput("");
              }}
            >
              <input
                type="text"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={feedKey ? maskKey(feedKey) : "合言葉"}
                aria-label="合言葉"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="min-h-[48px] min-w-0 flex-1 rounded-lg border-2 border-slate-300 px-3 font-mono text-[14px] focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!input.trim()}
                className="min-h-[48px] shrink-0 touch-manipulation rounded-lg bg-slate-950 px-4 font-black text-[14px] text-white disabled:bg-slate-300"
              >
                保存
              </button>
            </form>
            {inputError && (
              <p className="mt-1 font-bold text-[12px] text-red-600">
                {inputError}
              </p>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[13px]">
            <div
              role="status"
              data-feed-status={status.tone}
              className={`font-black ${status.tone === "emerald" ? "text-emerald-700" : status.tone === "red" ? "text-red-700" : "text-slate-600"}`}
            >
              {status.text}
            </div>
            {feed && (
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-slate-700">
                <dt className="font-bold text-slate-500">最後の配信</dt>
                <dd className="font-bold">{formatDateTime(feed.updatedAt)}</dd>
                <dt className="font-bold text-slate-500">読んだ時刻</dt>
                <dd className="font-bold">{formatDateTime(fetchedAt)}</dd>
                <dt className="font-bold text-slate-500">上級生</dt>
                <dd className="font-bold">{feed.seniors.length}人</dd>
              </dl>
            )}
            {feedKey && (
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={shiftFeed.reload}
                  className="flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 font-bold text-[13px] text-slate-800"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${loading ? "animate-spin" : ""}`}
                  />
                  読み直す
                </button>
                <button
                  type="button"
                  onClick={() => {
                    shiftFeed.clearKey();
                    setInputError(null);
                  }}
                  className="flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 font-bold text-[13px] text-red-700"
                >
                  <Trash2 className="h-4 w-4" />
                  合言葉を消す
                </button>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};
