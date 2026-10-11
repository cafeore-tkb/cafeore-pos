import {
  type CaosLane,
  dripperLabel,
  isSeniorName,
  laneCandidates,
} from "@cafeore/common";
import {
  ArrowLeftRight,
  KeyRound,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UserMinus,
  UserRound,
  X,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import type { ShiftFeedState } from "../hooks/useShiftFeed";
import {
  type ShiftFeedTone,
  noCandidateReason,
  shiftFeedStatus,
  typedSeniorNote,
} from "../logic/shiftFeed";
import { LaneName, SeniorMark } from "./LaneParts";

// ドリッパーの「交代」。sohosai-shift の予定（今の枠・次の枠・オペ練の今と次のラウンド）の、そのドリッパーの番目の人を候補に出す。
// 候補に無い人は自由に入れられ、空き（担当者なし）にもできる。ほかのドリッパーの担当者との入れ替えもここから。
// 押したらその場で替える（抽出中かどうかは見ない）。上級生のみのカードが待っているときの確認は CaosLanesProvider が出す。

interface LaneChangeDialogProps {
  lane: CaosLane;
  lanes: CaosLane[];
  shiftFeed: ShiftFeedState;
  /** 開いたときの時刻（候補の枠を決める） */
  nowMs: number;
  onPick: (name: string, senior: boolean) => void;
  onSwap: (other: number) => void;
  onOpenSettings: () => void;
  onClose: () => void;
}

const PersonName: React.FC<{ lane: CaosLane }> = ({ lane }) =>
  lane.name ? (
    <LaneName dripper={lane.dripper} />
  ) : (
    <span className="text-slate-400">担当者なし</span>
  );

export const LaneChangeDialog: React.FC<LaneChangeDialogProps> = ({
  lane,
  lanes,
  shiftFeed,
  nowMs,
  onPick,
  onSwap,
  onOpenSettings,
  onClose,
}) => {
  const { feed } = shiftFeed;
  const [typed, setTyped] = useState("");
  const ordinal = dripperLabel(lane.dripper);
  const candidates = useMemo(
    () => laneCandidates(feed, lane.dripper, nowMs, lane.name),
    [feed, lane.dripper, nowMs, lane.name],
  );
  const typedName = typed.trim();
  const typedSenior = isSeniorName(feed, typedName);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/40 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        open
        aria-modal="true"
        aria-label={`${ordinal} の交代`}
        className="static flex max-h-[calc(100vh-32px)] w-[min(600px,100%)] flex-col overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-2xl"
      >
        <header className="flex items-center justify-between border-slate-200 border-b bg-slate-50 px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-black text-[18px] text-slate-950">
              {ordinal} の交代
            </h2>
            <div className="mt-0.5 flex items-center gap-1 font-bold text-[13px] text-slate-600">
              <span>今：</span>
              <PersonName lane={lane} />
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 touch-manipulation items-center justify-center rounded-full hover:bg-slate-200"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="font-black text-[13px] text-slate-700">
                sohosai-shift の予定から
              </h3>
              <button
                type="button"
                onClick={onOpenSettings}
                className="flex min-h-[36px] touch-manipulation items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 font-bold text-[12px] text-slate-700"
              >
                <KeyRound className="h-3.5 w-3.5" />
                合言葉
              </button>
            </div>
            {candidates.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {candidates.map((candidate) => (
                  <button
                    key={candidate.name}
                    type="button"
                    data-lane-candidate={candidate.name}
                    onClick={() => onPick(candidate.name, candidate.senior)}
                    className="flex min-h-[56px] touch-manipulation flex-col items-start justify-center rounded-xl border-2 border-blue-500 bg-blue-50 px-3 py-2 text-left active:scale-[0.98]"
                  >
                    <span className="flex items-center gap-1.5 font-black text-[16px] text-slate-950">
                      <UserRound className="h-4 w-4 shrink-0 text-slate-500" />
                      {candidate.name}
                      {candidate.senior && <SeniorMark />}
                    </span>
                    <span className="mt-0.5 font-bold text-[11px] text-slate-500 leading-snug">
                      {candidate.reasons.join("・")}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-bold text-[12px] text-slate-500">
                {noCandidateReason(shiftFeed)}
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-2 font-black text-[13px] text-slate-700">
              名前を入れる
            </h3>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (typedName) onPick(typedName, typedSenior);
              }}
            >
              <input
                type="text"
                value={typed}
                maxLength={40}
                onChange={(event) => setTyped(event.target.value)}
                placeholder="氏名"
                aria-label="担当者の名前"
                className="min-h-[48px] min-w-0 flex-1 rounded-lg border-2 border-slate-300 px-3 font-bold text-[16px] focus:border-blue-500 focus:outline-none"
              />
              <button
                type="submit"
                disabled={!typedName}
                className="min-h-[48px] shrink-0 touch-manipulation rounded-lg bg-slate-950 px-4 font-black text-[14px] text-white disabled:bg-slate-300"
              >
                この名前にする
              </button>
            </form>
            {typedName && (
              <p className="mt-1.5 font-bold text-[12px] text-slate-500">
                {typedSeniorNote(typedSenior, feed)}
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-2 font-black text-[13px] text-slate-700">
              ほかのドリッパーの担当者と入れ替える
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {lanes
                .filter((other) => other.dripper !== lane.dripper)
                .map((other) => (
                  <button
                    key={other.dripper}
                    type="button"
                    data-lane-swap={other.dripper}
                    onClick={() => onSwap(other.dripper)}
                    className="flex min-h-[48px] touch-manipulation items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2 text-left font-bold text-[13px] text-slate-800 active:scale-[0.98]"
                  >
                    <ArrowLeftRight className="h-4 w-4 shrink-0 text-slate-500" />
                    <span className="shrink-0 font-black font-mono">
                      {dripperLabel(other.dripper)}
                    </span>
                    <PersonName lane={other} />
                  </button>
                ))}
            </div>
          </section>
        </div>

        <footer className="flex items-center justify-between gap-2 border-slate-200 border-t bg-slate-50 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] touch-manipulation rounded-lg border border-slate-300 bg-white px-4 font-bold text-[13px] text-slate-700"
          >
            やめる
          </button>
          <button
            type="button"
            disabled={!lane.name}
            onClick={() => onPick("", false)}
            className="flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 font-black text-[13px] text-slate-800 disabled:text-slate-300"
          >
            <UserMinus className="h-4 w-4" />
            空きにする
          </button>
        </footer>
      </dialog>
    </div>
  );
};

// 上級生でない人（担当者なしも）にするドリッパーに、上級生のみのカードが待っているときの確認。ボタンは［まだ変えない］［変える］の 2 つだけ。
// ［変える］なら、そのまま交代し、上級生のみのカードもそのドリッパーに残る（未割当へ戻すなどはしない）。

interface LaneConfirmDialogProps {
  /** 例「このドリッパーに上級生のみのカードが2枚あります（佐藤さんは上級生ではありません）」。ドリッパーごとに 1 行 */
  messages: string[];
  onCancel: () => void;
  onConfirm: () => void;
}

export const LaneConfirmDialog: React.FC<LaneConfirmDialogProps> = ({
  messages,
  onCancel,
  onConfirm,
}) => (
  <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2">
          <TriangleAlert className="h-6 w-6 shrink-0 text-amber-500" />
          交代の確認
        </AlertDialogTitle>
        {messages.map((message) => (
          <AlertDialogDescription
            key={message}
            className="font-black text-[16px] text-slate-950"
          >
            {message}
          </AlertDialogDescription>
        ))}
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>まだ変えない</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>変える</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

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

// 読み込みの様子の文字色
const STATUS_TEXT: Record<ShiftFeedTone, string> = {
  ok: "text-emerald-700",
  error: "text-red-700",
  none: "text-slate-600",
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
  const { feedKey, feed, loading, fetchedAt } = shiftFeed;
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);

  const status = shiftFeedStatus(shiftFeed);

  return (
    <div
      className="fixed inset-0 z-[205] flex items-center justify-center bg-slate-950/40 p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        open
        aria-modal="true"
        aria-label="sohosai-shift の合言葉"
        className="static w-[min(520px,100%)] overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-2xl"
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
              へ配信したときの合言葉です。この端末にだけ覚えさせます。交代のときの名前の候補と、上級生の判定に使います。予定どおりに自動で交代はしません。
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
            <output
              data-feed-status={status.tone}
              className={`block font-black ${STATUS_TEXT[status.tone]}`}
            >
              {status.text}
            </output>
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
      </dialog>
    </div>
  );
};
