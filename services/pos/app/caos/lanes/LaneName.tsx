import { Star, UserRoundPen } from "lucide-react";
import type React from "react";
import { useCaosLanes, useLane } from "./CaosLanesContext";

// ドリッパーの見出しの担当者。「1st 山田★」のように、番号（各画面がもう出している）の横に名前と上級生の印を出す。
// 担当者がいなければ何も出さない（番号だけ）。交代のボタンは操作の画面だけに出す。

/** 上級生（限定を淹れられる人）の印 */
export const SeniorMark: React.FC<{ className?: string }> = ({
  className = "",
}) => (
  <span
    title="上級生（限定を淹れられる）"
    aria-label="上級生"
    className={`inline-flex shrink-0 items-center text-amber-500 ${className}`}
  >
    <Star className="h-3.5 w-3.5 fill-current" />
  </span>
);

/** そのドリッパーの担当者の名前と上級生の印。担当者がいなければ何も出さない */
export const LaneName: React.FC<{ dripper: number; className?: string }> = ({
  dripper,
  className = "",
}) => {
  const lane = useLane(dripper);
  if (!lane?.name) return null;
  return (
    <span
      data-lane-name={dripper}
      title={lane.senior ? `${lane.name}（上級生）` : lane.name}
      className={`inline-flex min-w-0 items-center gap-0.5 ${className}`}
    >
      <span className="truncate">{lane.name}</span>
      {lane.senior && <SeniorMark />}
    </span>
  );
};

/** 「交代」のボタン。閲覧だけの画面では出さない。compact なら印だけ（幅の狭い見出し） */
export const LaneChangeButton: React.FC<{
  dripper: number;
  compact?: boolean;
  className?: string;
}> = ({ dripper, compact = false, className = "" }) => {
  const { editable, openChange } = useCaosLanes();
  if (!editable) return null;
  return (
    <button
      type="button"
      data-lane-change={dripper}
      onClick={(event) => {
        event.stopPropagation();
        openChange(dripper);
      }}
      onPointerDown={(event) => event.stopPropagation()}
      title="担当者を交代"
      aria-label={compact ? "交代" : undefined}
      className={`inline-flex h-7 shrink-0 touch-manipulation items-center gap-0.5 rounded-md border border-slate-300 bg-white px-1.5 font-black text-[11px] text-slate-700 hover:bg-slate-50 active:scale-95 ${className}`}
    >
      <UserRoundPen className="h-3.5 w-3.5" />
      {!compact && "交代"}
    </button>
  );
};
