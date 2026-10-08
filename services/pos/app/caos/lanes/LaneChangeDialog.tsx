import {
  type CaosLane,
  caosLaneOrdinal,
  isSeniorName,
  laneCandidates,
} from "@cafeore/common";
import {
  ArrowLeftRight,
  KeyRound,
  UserMinus,
  UserRound,
  X,
} from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { SeniorMark } from "./LaneName";
import type { ShiftFeedState } from "./useShiftFeed";

// ドリッパーの「交代」。sohosai-shift の予定（今の枠・次の枠・オペ練の今と次のラウンド）の、そのドリッパーの番目の人を候補に出す。
// 候補に無い人は自由に入れられ、空き（担当者なし）にもできる。ほかのドリッパーの担当者との入れ替えもここから。
// 押したらその場で替える（抽出中かどうかは見ない）。限定のカードが待っているときの確認は CaosLanesProvider が出す。

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
    <span className="inline-flex min-w-0 items-center gap-0.5">
      <span className="truncate">{lane.name}</span>
      {lane.senior && <SeniorMark />}
    </span>
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
  const { feed, feedKey, error, loading } = shiftFeed;
  const [typed, setTyped] = useState("");
  const ordinal = caosLaneOrdinal(lane.dripper);
  const candidates = useMemo(
    () => laneCandidates(feed, lane.dripper, nowMs, lane.name),
    [feed, lane.dripper, nowMs, lane.name],
  );
  const typedName = typed.trim();
  const typedSenior = isSeniorName(feed, typedName);
  const feedNote = !feedKey
    ? "この端末に sohosai-shift の合言葉が入っていないので、候補は出ません（名前を入れて交代できます）"
    : !feed
      ? loading
        ? "予定を読んでいます…"
        : `予定を読めません${error ? `：${error}` : ""}`
      : "今の枠・次の枠・オペ練に、この番目の人がいません";

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
        className="flex max-h-[calc(100vh-32px)] w-[min(600px,100%)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
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
                {feedNote}
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
                {typedSenior
                  ? "上級生です（限定を淹れられます）"
                  : feed
                    ? "sohosai-shift の上級生の名簿にありません（限定を淹れられません）"
                    : "上級生の名簿が無いので、限定を淹れられない人として扱います"}
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
                      {caosLaneOrdinal(other.dripper)}
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
      </div>
    </div>
  );
};
