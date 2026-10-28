import {
  type CaosLane,
  dripperLabel,
  isSeniorName,
  laneCandidates,
  matchesShiftMember,
} from "@cafeore/common";
import {
  ArrowLeftRight,
  KeyRound,
  RefreshCw,
  Trash2,
  UserMinus,
  UserRound,
  X,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePanelOutsidePress } from "../hooks/useOutsidePress";
import type { ShiftFeedState } from "../hooks/useShiftFeed";
import { gradeMembers } from "../logic/dripSupport";
import {
  type ShiftFeedTone,
  noCandidateReason,
  shiftFeedStatus,
  typedSeniorNote,
} from "../logic/shiftFeed";
import { useFloatingWindow } from "./FloatingWindows";
import { LaneName, SeniorMark } from "./LaneParts";

// ドリッパーの「交代」。sohosai-shift の予定（今の枠・次の枠・オペ練の今と次のラウンド）の、そのドリッパーの番目の人を候補に出す。
// 候補に無い人は自由に入れられ、空き（担当者なし）にもできる。ほかのドリッパーの担当者との入れ替えもここから。
// 押したらその場で替える（抽出中かどうかは見ない）。指名の無い上級生のみのカードがあるときの知らせ（POS の通知）は CaosLanesProvider が出す。

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
  const [query, setQuery] = useState("");
  const [grade, setGrade] = useState<string | null>(null);
  const members = useMemo(
    () => gradeMembers(feed, lane.name),
    [feed, lane.name],
  );
  const gradeOrder = ["B1", "B2", "B3", "B4", "M1", "M2", "D1", "D2", "D3"];
  const grades = [
    ...new Set(gradeMembers(feed, "").map((member) => member.grade)),
  ].sort((a, b) => {
    const position = (grade: string) =>
      gradeOrder.includes(grade) ? gradeOrder.indexOf(grade) : 100;
    return (
      position(a) - position(b) || a.localeCompare(b, "ja", { numeric: true })
    );
  });
  const selectedGrade = grade !== null && grades.includes(grade) ? grade : null;
  useEffect(() => {
    if (grade !== selectedGrade) setGrade(selectedGrade);
  }, [grade, selectedGrade]);
  // 後ろの幕を押すと閉じる（その 1 回は閉じるだけ。名前を打っているあいだは入力を終えるだけ）
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const floating = useFloatingWindow("担当者の交代");
  usePanelOutsidePress(dialogRef, floating.hide, !floating.hidden);
  const ordinal = dripperLabel(lane.dripper);
  const candidates = useMemo(
    () => laneCandidates(feed, lane.dripper, nowMs, lane.name),
    [feed, lane.dripper, nowMs, lane.name],
  );
  const searching = Boolean(query.trim());
  const shownCandidates = (
    !searching && selectedGrade === null
      ? candidates
      : members
          .filter(
            (member) =>
              (selectedGrade === null || member.grade === selectedGrade) &&
              matchesShiftMember(member, query),
          )
          .map((member) => ({
            name: member.name,
            senior: isSeniorName(feed, member.name),
            reasons: [
              member.grade,
              ...(candidates.find((c) => c.name === member.name)?.reasons ||
                []),
            ],
          }))
  ).map((candidate) => ({
    ...candidate,
    display: members.find((member) => member.name === candidate.name)?.display,
  }));
  const typedName = typed.trim();
  const typedSenior = isSeniorName(feed, typedName);

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/40 p-4"
      data-caos-backdrop
      data-popup-hidden={floating.hidden}
      style={floating.hidden ? { display: "none" } : undefined}
    >
      <dialog
        ref={(element) => {
          dialogRef.current = element;
          floating.ref.current = element;
        }}
        style={floating.style}
        open
        aria-modal="true"
        aria-label={`${ordinal} の交代`}
        className="static flex max-h-[calc(100vh-32px)] w-[min(600px,100%)] flex-col overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-2xl"
      >
        <header className="flex items-center justify-between border-slate-200 border-b bg-slate-50 px-5 py-3">
          {floating.handle}
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
            onClick={floating.hide}
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
                {searching
                  ? `検索結果（${shownCandidates.length}人）`
                  : selectedGrade === null
                    ? "シフトの予定から"
                    : `${selectedGrade}の候補`}
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
            <label className="mb-3 block font-bold text-slate-700 text-sm">
              交代する人を検索
              <input
                type="search"
                value={query}
                maxLength={160}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="氏名・ひらがな・ローマ字・ニックネーム"
                className="mt-1 min-h-[48px] w-full rounded-lg border-2 border-slate-300 px-3 text-[16px] focus:border-blue-500 focus:outline-none"
              />
            </label>
            <p className="mb-3 text-slate-500 text-xs">
              名字・名前の一部や、空白で区切った複数の語で検索できます。
            </p>
            <div
              className="mb-3 flex flex-wrap gap-2"
              aria-label="候補者の学年"
            >
              {[null, ...grades].map((value) => (
                <button
                  key={value ?? "schedule"}
                  type="button"
                  aria-pressed={selectedGrade === value}
                  onClick={() => setGrade(value)}
                  className={`min-h-10 touch-manipulation rounded-lg border-2 px-3 font-bold text-xs ${selectedGrade === value ? "border-blue-700 bg-blue-700 text-white" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  {value ?? (searching ? "すべての学年" : "予定の候補")}
                </button>
              ))}
            </div>
            {!feed?.members && (
              <p className="mb-2 text-slate-500 text-xs">
                学年はシフト側で名簿を配信すると表示されます。
              </p>
            )}
            {shownCandidates.length > 0 ? (
              <div className="grid grid-cols-2 gap-2">
                {shownCandidates.map((candidate) => (
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
                    {candidate.display &&
                    candidate.display !== candidate.name ? (
                      <span className="text-slate-600 text-xs">
                        {candidate.display}
                      </span>
                    ) : null}
                    <span className="mt-0.5 font-bold text-[11px] text-slate-500 leading-snug">
                      {candidate.reasons.join("・")}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 font-bold text-[12px] text-slate-500">
                {searching && feed
                  ? "一致する候補者はいません。学年の絞り込みや検索語を確認してください。読み仮名・呼び名をシフト側で更新した場合は、配信し直してから予定を読み直してください。"
                  : selectedGrade === null
                    ? noCandidateReason(shiftFeed)
                    : "この学年の候補者はいません。"}
              </p>
            )}
          </section>

          <section>
            <h3 className="mb-2 font-black text-[13px] text-slate-700">
              名簿にない名前を直接入力
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
}) => {
  const { feedKey, feed, loading, fetchedAt } = shiftFeed;
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState<string | null>(null);
  // 後ろの幕を押すと閉じる（その 1 回は閉じるだけ。合言葉を打っているあいだは入力を終えるだけ）
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const floating = useFloatingWindow("シフトの合言葉");
  usePanelOutsidePress(dialogRef, floating.hide, !floating.hidden);

  const status = shiftFeedStatus(shiftFeed);

  return (
    <div
      className="fixed inset-0 z-[205] flex items-center justify-center bg-slate-950/40 p-4"
      data-caos-backdrop
      data-popup-hidden={floating.hidden}
      style={floating.hidden ? { display: "none" } : undefined}
    >
      <dialog
        ref={(element) => {
          dialogRef.current = element;
          floating.ref.current = element;
        }}
        style={floating.style}
        open
        aria-modal="true"
        aria-label="sohosai-shift の合言葉"
        className="static w-[min(520px,100%)] overflow-hidden rounded-2xl border-0 bg-white p-0 shadow-2xl"
      >
        <header className="flex items-center justify-between border-slate-200 border-b bg-slate-50 px-5 py-3">
          {floating.handle}
          <h2 className="flex items-center gap-1.5 font-black text-[18px] text-slate-950">
            <KeyRound className="h-5 w-5" />
            sohosai-shift の合言葉
          </h2>
          <button
            type="button"
            onClick={floating.hide}
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
