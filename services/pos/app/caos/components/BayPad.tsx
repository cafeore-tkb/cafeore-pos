import type React from "react";
import { moveTargets } from "../utils/lanes";

// カードの上に前半（1〜3）、下に後半（4〜6）を出すドリッパーのボタン。
// 未割当カード（管制盤 A・C）と待機カード（管制盤 A）で共通。待機カードは今のドリッパーのボタンが「先頭」。
// 指名のあるカードは指名のドリッパーだけ押せる。ドラッグで指を滑らせて選べるよう、ボタンは data-bay-target を持つ（lanes.ts の bayTargetAt）。
export const BayPad: React.FC<{
  preferredBaristaId?: number;
  /** 待機カードの今のドリッパー */
  currentBayId?: number;
  /** ドラッグで指の下にあるドリッパー */
  hoveredBay: number | null;
  /** ドラッグ中、カードと一緒に動かないよう打ち消す */
  style?: React.CSSProperties;
  onPick: (bayId: number, toFront: boolean) => void;
}> = ({ preferredBaristaId, currentBayId, hoveredBay, style, onPick }) => {
  const targets = moveTargets(preferredBaristaId, currentBayId ?? null);
  const half = Math.ceil(targets.length / 2);
  return [targets.slice(0, half), targets.slice(half)].map((row, index) => (
    <div
      key={row[0].bayId}
      className={`${index === 0 ? "-top-[38px]" : "-bottom-[38px]"} absolute right-0 left-0 z-[90] grid h-[34px] grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 shadow-xl`}
      style={style}
    >
      {row.map(({ bayId, toFront, disabled }) => (
        <button
          key={bayId}
          type="button"
          data-bay-target={bayId}
          disabled={disabled}
          onClick={(event) => {
            event.stopPropagation();
            onPick(bayId, toFront);
          }}
          className={`h-full touch-none rounded-md border font-black font-mono text-[17px] transition-colors disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-500 ${hoveredBay === bayId ? "border-white bg-blue-500 text-white" : preferredBaristaId === bayId ? "border-violet-300 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-950"}`}
        >
          {toFront ? "先頭" : bayId}
        </button>
      ))}
    </div>
  ));
};
