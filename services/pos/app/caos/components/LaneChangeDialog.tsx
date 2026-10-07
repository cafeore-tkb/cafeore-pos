import {
  type ShiftFeed,
  isSeniorName,
  laneCandidates,
  laneOrdinal,
} from "@cafeore/common";
import { UserMinus, UserRound, X } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import type { Barista } from "../types";
import { LaneName, SeniorMark } from "./LaneName";

// 列の「交代」。sohosai-shift の予定（今の枠・次の枠・オペ練の今（次）のラウンド）の、その番目の人を上に候補として出す。
// 候補に無い人は自由に入力でき、空き（担当者なし）にもできる。予定どおりに自動で替えることはしない。
// 押したらその場で替える（抽出中かどうかは見ない）。限定のカードが待っているときの確認は App が出す。

interface LaneChangeDialogProps {
  barista: Barista;
  feed: ShiftFeed | null;
  /** 合言葉を入れていないか、読めないときの説明 */
  feedNote: string | null;
  nowMs: number;
  onPick: (name: string) => void;
  onClose: () => void;
}

export const LaneChangeDialog: React.FC<LaneChangeDialogProps> = ({
  barista,
  feed,
  feedNote,
  nowMs,
  onPick,
  onClose,
}) => {
  const [typed, setTyped] = useState("");
  const ordinal = laneOrdinal(barista.bayNumber);
  // 開いている間は候補の並びを変えない（開いた時刻で決める）
  // biome-ignore lint/correctness/useExhaustiveDependencies: nowMs は開いたときの値だけ使う
  const candidates = useMemo(
    () => laneCandidates(feed, barista.bayNumber, nowMs, barista.name),
    [feed, barista.bayNumber, barista.name],
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
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${ordinal} の交代`}
        className="flex max-h-[calc(100vh-32px)] w-[min(560px,100%)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-slate-200 border-b bg-slate-50 px-5 py-3">
          <div className="min-w-0">
            <h2 className="font-black text-[18px] text-slate-950">
              {ordinal} の交代
            </h2>
            <div className="mt-0.5 flex items-center gap-1 font-bold text-[13px] text-slate-600">
              <span>今：</span>
              {barista.name ? (
                <LaneName barista={barista} />
              ) : (
                <span className="text-slate-400">担当者なし</span>
              )}
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
            <h3 className="mb-2 font-black text-[13px] text-slate-700">
              sohosai-shift の予定から
            </h3>
            {candidates.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {candidates.map((candidate) => (
                  <button
                    key={candidate.name}
                    type="button"
                    data-lane-candidate={candidate.name}
                    onClick={() => onPick(candidate.name)}
                    className={`flex min-h-[56px] touch-manipulation flex-col items-start justify-center rounded-xl border-2 px-3 py-2 text-left active:scale-[0.98] ${candidate.forThisLane ? "border-blue-500 bg-blue-50" : "border-slate-200 bg-white"}`}
                  >
                    <span className="flex items-center gap-1.5 font-black text-[16px] text-slate-950">
                      <UserRound className="h-4 w-4 shrink-0 text-slate-500" />
                      {candidate.name}
                      {candidate.senior && <SeniorMark />}
                    </span>
                    {candidate.reasons.length > 0 && (
                      <span className="mt-0.5 font-bold text-[11px] text-slate-500 leading-snug">
                        {candidate.reasons.join("・")}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-bold text-[12px] text-slate-500">
                {feedNote ?? "今日の予定に名前がありません"}
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
                if (typedName) onPick(typedName);
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
                {typedSenior
                  ? "上級生です（限定を淹れられます）"
                  : feed
                    ? "sohosai-shift の上級生の名簿にありません（限定を淹れられません）"
                    : "上級生か分からないため、限定を淹れられない人として扱います"}
              </p>
            )}
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
            disabled={!barista.name}
            onClick={() => onPick("")}
            className="flex min-h-[44px] touch-manipulation items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 font-black text-[13px] text-slate-800 disabled:text-slate-300"
          >
            <UserMinus className="h-4 w-4" />
            空きにする
          </button>
        </footer>
      </div>
    </div>
  );
};
