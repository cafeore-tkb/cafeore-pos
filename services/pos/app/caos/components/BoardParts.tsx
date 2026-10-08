import { ArrowRightCircle, type LucideIcon, Plus } from "lucide-react";
import type React from "react";
import { clockLabel } from "../logic/format";
import { laneOrdinal } from "../logic/lanes";
import type { NextAvailable } from "../logic/queue";

// 管制盤 A・C・D で共通の部品（パネルの見出し・列の番号・「次へ」・空きスロット・次に空く）

/** パネルの見出し（アイコン・題・右に添えるもの） */
export const PanelHeader: React.FC<{
  icon: LucideIcon;
  title: string;
  className?: string;
  children?: React.ReactNode;
}> = ({
  icon: Icon,
  title,
  className = "border-slate-200 border-b",
  children,
}) => (
  <header
    className={`flex h-11 shrink-0 items-center gap-2 rounded-t-lg bg-slate-50 px-3 ${className}`}
  >
    <Icon className="h-4 w-4 shrink-0 text-slate-700" />
    <h2 className="shrink-0 font-black text-[15px] text-slate-950">{title}</h2>
    {children}
  </header>
);

/** 列の番号（1st〜6th）。担当者の名前は出さない */
export const LaneBadge: React.FC<{ bayId: number }> = ({ bayId }) => (
  <span className="flex h-8 w-fit min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 px-1 font-bold font-mono text-[13px] text-slate-600">
    {laneOrdinal(bayId)}
  </span>
);

// 「次へ」の色（待機は灰、まもなく終わる列は黄、ほかは緑）
const nextTone = (active: boolean, soon: boolean) => {
  if (!active) return "bg-slate-200 text-slate-500";
  if (soon) return "bg-amber-500 text-slate-950 ring-2 ring-amber-200";
  return "bg-emerald-700 text-white";
};

/** 「次へ」（抽出中のカードを終えて待機の先頭を始める）。まもなく終わる列は黄色。remainingSec を渡すと残り時間も出す */
export const NextButton: React.FC<{
  bayId: number;
  /** 抽出中のカードがある */
  active: boolean;
  /** まもなく終わる */
  soon: boolean;
  remainingSec?: number;
  onAdvance: (bayId: number) => void;
  className?: string;
}> = ({ bayId, active, soon, remainingSec, onAdvance, className = "" }) => (
  <button
    type="button"
    disabled={!active}
    onClick={() => onAdvance(bayId)}
    title={`${laneOrdinal(bayId)}の現在の抽出を確定して次へ`}
    className={`flex touch-manipulation items-center justify-center gap-1 rounded-lg font-black shadow-xs active:scale-95 ${nextTone(active, soon)} ${className}`}
  >
    {active && remainingSec !== undefined && (
      <span className="font-mono">
        {remainingSec === 0 ? "継続" : clockLabel(remainingSec)}
      </span>
    )}
    <span>{active ? "次へ" : "待機"}</span>
    {active && <ArrowRightCircle className="h-4 w-4 shrink-0" />}
  </button>
);

/** 空きスロット（押すと、このドリッパーへの割当のパネルを開く） */
export const EmptySlotButton: React.FC<{
  onClick: () => void;
  className?: string;
}> = ({ onClick, className = "" }) => (
  <button
    type="button"
    onClick={onClick}
    title="タップして未割当オーダーをこのドリッパーに割り当て"
    className={`flex touch-manipulation select-none items-center justify-center gap-1 rounded-lg border-2 border-slate-300 border-dashed bg-slate-50 px-2 font-bold text-[12px] text-slate-500 hover:border-blue-400 hover:text-blue-600 active:bg-blue-100/70 ${className}`}
  >
    <Plus className="h-4 w-4 shrink-0" />
    空きスロット
  </button>
);

/** 「次に空く」ドリッパー（未割当とドリッパーの見出し） */
export const NextAvailableChips: React.FC<{ nextAvailable: NextAvailable }> = ({
  nextAvailable,
}) => (
  <div className="ml-1 flex min-w-0 items-center gap-1 font-bold text-[10px] text-slate-500">
    <span className="shrink-0">次に空く:</span>
    {nextAvailable.map((item, index) => (
      <span
        key={item.bayId}
        className={`shrink-0 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono ${index === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}
      >
        #{item.bayId} {item.isStandby ? "待機" : clockLabel(item.seconds)}
      </span>
    ))}
  </div>
);
