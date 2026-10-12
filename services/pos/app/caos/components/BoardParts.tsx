import { type CaosCard, dripperLabel } from "@cafeore/common";
import { ArrowRightCircle, type LucideIcon, Plus } from "lucide-react";
import type React from "react";
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
import { orderLabel } from "../logic/cards";
import { clockLabel } from "../logic/format";
import type { LanePhase, LaneStatus, NextAvailable } from "../logic/queue";

// 管制盤 A・C・D で共通の部品（パネルの見出し・列の番号と状態・「次へ」・空きスロット・次に空く）

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

/** 列の番号（1st〜6th。右のパネルの列の一覧）。担当者の名前は出さない */
export const LaneBadge: React.FC<{ bayId: number }> = ({ bayId }) => (
  <span className="flex h-8 w-fit min-w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 px-1 font-bold font-mono text-[13px] text-slate-600">
    {dripperLabel(bayId)}
  </span>
);

// 列の状態の色と札（ドリッパーの番号に出す）。空きは「今すぐ割り当てられる」ので一番目立たせ、待機（始めていない）は青、
// 抽出中は白、まもなくは黄、予定より長くかかっている継続中は薄い赤（caos.css の --caos-overtime。緊急の赤・「次へ」の橙と分ける）。
// 色だけに頼らず札の文字も出す
const PHASES: Record<LanePhase, { label: string; className: string }> = {
  empty: {
    label: "空き",
    className: "border-emerald-700 bg-emerald-500 text-white",
  },
  waiting: { label: "待機", className: "border-sky-800 bg-sky-600 text-white" },
  brewing: {
    label: "抽出中",
    className: "border-emerald-600 bg-white text-slate-950",
  },
  soon: {
    label: "まもなく",
    className: "border-amber-600 bg-amber-300 text-slate-950",
  },
  overtime: {
    label: "継続中",
    className:
      "border-(color:--caos-overtime-line) bg-(color:--caos-overtime) text-(color:--caos-overtime-text)",
  },
};

/**
 * ドリッパーの番号（1st〜6th）を、列の状態のインジケーターにしたもの（管制盤 A・C・D の列の見出し）。
 * 番号の地の色と札で状態（空き・待機・抽出中・まもなく・継続中）を、抽出中は残りも出す。
 * そのドリッパーを待っている指名（未割当）があれば、角に「指名 2」（杯数）を付ける。
 * 押すと列の操作（担当者の交代・待機をまとめて移す）を開く（onOpenLane を渡したときだけ）
 */
export const DripperIndicator: React.FC<{
  bayId: number;
  status: LaneStatus;
  nominatedCups: number;
  onOpenLane?: (bayId: number) => void;
  className?: string;
}> = ({ bayId, status, nominatedCups, onOpenLane, className = "" }) => {
  const phase = PHASES[status.phase];
  const showsRemaining = status.phase === "brewing" || status.phase === "soon";
  return (
    <button
      type="button"
      disabled={!onOpenLane}
      onClick={() => onOpenLane?.(bayId)}
      data-lane-phase={status.phase}
      className={`relative flex shrink-0 touch-manipulation flex-col items-center justify-center rounded-lg border-2 pt-2 leading-none enabled:active:scale-95 ${phase.className} ${className}`}
    >
      <span className="font-black font-mono text-[22px]">
        {dripperLabel(bayId)}
      </span>
      <span className="mt-1 flex items-baseline gap-0.5 whitespace-nowrap font-black text-[11px]">
        {phase.label}
        {showsRemaining && (
          <span className="font-mono text-[14px] tabular-nums">
            {clockLabel(status.remainingSec)}
          </span>
        )}
      </span>
      {nominatedCups > 0 && (
        <span
          title={`${dripperLabel(bayId)}への指名が ${nominatedCups} 杯、未割当で待っています`}
          className="-top-2.5 -translate-x-1/2 absolute left-1/2 z-10 whitespace-nowrap rounded-full border-2 border-white border-dashed bg-slate-900 px-1.5 py-0.5 font-black text-[11px] text-white leading-none shadow"
        >
          指名{nominatedCups}
        </span>
      )}
    </button>
  );
};

/**
 * 「次へ」（抽出中のカードを終えて待機の先頭を始める）。押せないとき（カードが無い・locked）は薄い枠だけ。列の状態はドリッパーの番号に出す。
 * locked のあいだ（抽出を始めてすぐ。二度押しを防ぐ）は押せない
 */
export const NextButton: React.FC<{
  bayId: number;
  /** 抽出中か待機のカードがある */
  active: boolean;
  /** まだ押せない（抽出を始めてすぐ） */
  locked?: boolean;
  onAdvance: (bayId: number) => void;
  className?: string;
}> = ({ bayId, active, locked = false, onAdvance, className = "" }) => (
  <button
    type="button"
    disabled={!active || locked}
    onClick={() => onAdvance(bayId)}
    title={`${dripperLabel(bayId)}の現在の抽出を確定して次へ`}
    className={`flex touch-manipulation items-center justify-center gap-1 rounded-lg border-2 font-black shadow-xs active:scale-95 enabled:border-orange-700 enabled:bg-orange-600 enabled:text-white disabled:border-slate-200 disabled:border-dashed disabled:bg-white disabled:text-slate-300 disabled:shadow-none ${className}`}
  >
    次へ
    {active && <ArrowRightCircle className="h-4 w-4 shrink-0" />}
  </button>
);

/** 押し間違いかもしれない「次へ」（抽出時間の半分もたっていない）を確かめる。［やめる］［次へ進める］ */
export const NextConfirmDialog: React.FC<{
  bayId: number;
  card: CaosCard;
  elapsedSec: number;
  onCancel: () => void;
  onConfirm: () => void;
}> = ({ bayId, card, elapsedSec, onCancel, onConfirm }) => (
  <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>
          {dripperLabel(bayId)} の {orderLabel(card)} を終えますか？
        </AlertDialogTitle>
        <AlertDialogDescription className="font-black text-[16px] text-slate-950">
          始めてからまだ {clockLabel(elapsedSec)}{" "}
          です。押す列を間違えていませんか？
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>やめる</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>次へ進める</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
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
        #{item.bayId} {item.isStandby ? "空き" : clockLabel(item.seconds)}
      </span>
    ))}
  </div>
);

/** ドリッパーに置いたカードの場所の札（「3rd 2番目」）。カードを包む relative の枠の右上に重ねる（管制盤 C の注文の列・D の表） */
export const PlaceTag: React.FC<{ label?: string }> = ({ label }) =>
  label && (
    <span className="-top-2 absolute right-1 z-20 whitespace-nowrap rounded-full bg-slate-900 px-1.5 py-0.5 font-black font-mono text-[11px] text-white leading-none shadow-xs">
      {label}
    </span>
  );
