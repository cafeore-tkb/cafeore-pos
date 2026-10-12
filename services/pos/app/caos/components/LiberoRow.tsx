import { dripperLabel, readableTextColor } from "@cafeore/common";
import type React from "react";
import { cardItemName, orderLabel } from "../logic/cards";
import { clockLabel } from "../logic/format";
import type { LiberoBrew, LiberoLane } from "../logic/libero";
import { LaneName } from "./LaneParts";

// リベロビューの 1 行（1 つのドリッパー）。抽出中は、経過の長い順の順位と経過（秒まで）をいちばん大きく出し、
// 進み具合の段（logic/libero.ts の step）で地・枠・順位・帯を濃くする。予定の抽出時間を過ぎたら継続中の赤（caos.css の --caos-overtime）。
// 抽出していない（待機だけ・空き）ドリッパーは薄く、順位も経過も出さない。

// 段ごとの見た目（添字が step。最後が予定の抽出時間を過ぎたとき）
const STEP_LOOKS = [
  {
    row: "border-(--caos-elapsed-1) bg-white",
    mark: "bg-(--caos-elapsed-1) text-slate-950",
  },
  {
    row: "border-(--caos-elapsed-2) bg-(--caos-elapsed-2)/10",
    mark: "bg-(--caos-elapsed-2) text-slate-950",
  },
  {
    row: "border-(--caos-elapsed-3) bg-(--caos-elapsed-3)/15",
    mark: "bg-(--caos-elapsed-3) text-white",
  },
  {
    row: "border-(--caos-elapsed-4) bg-(--caos-elapsed-4)/20",
    mark: "bg-(--caos-elapsed-4) text-white",
  },
  {
    row: "border-(color:--caos-overtime-line) bg-(color:--caos-overtime) text-(color:--caos-overtime-text)",
    mark: "bg-(color:--caos-overtime-line) text-white",
  },
];

export const LiberoRow: React.FC<{
  row: LiberoLane;
  /** 抽出中のカードの地の色（色の設定。logic/cards.ts の cardColor） */
  color?: string;
}> = ({ row: { lane, brew }, color }) => {
  const look = brew ? STEP_LOOKS[brew.step] : undefined;
  return (
    <div
      data-libero-dripper={lane.id}
      data-libero-rank={brew?.rank}
      className={`grid min-h-0 grid-cols-[11vh_minmax(0,1fr)_minmax(0,2fr)_auto] items-center gap-[2vh] rounded-xl border-4 px-[1.5vh] ${look?.row ?? "border-transparent bg-slate-200/50 text-slate-400"}`}
    >
      <span
        className={`flex aspect-square items-center justify-center rounded-xl font-black font-mono text-[7.5vh] leading-none ${look?.mark ?? ""}`}
      >
        {brew?.rank}
      </span>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="font-black font-mono text-[5.5vh] leading-none">
          {dripperLabel(lane.id)}
        </span>
        <LaneName dripper={lane.id} className="font-bold text-[3.6vh]" />
      </div>
      {brew ? (
        <>
          <BrewDetail
            brew={brew}
            color={color}
            markClassName={look?.mark ?? ""}
          />
          <span className="font-black font-mono text-[10vh] tabular-nums leading-none">
            {clockLabel(brew.elapsedSec)}
          </span>
        </>
      ) : (
        <span className="col-span-2 font-black text-[3.6vh]">
          {lane.queued.length > 0 ? `待機 ${lane.queued.length} 件` : "空き"}
        </span>
      )}
    </div>
  );
};

// 何を何杯（商品の略称と、色の設定の地の色）・注文番号と、予定の抽出時間に対する進み具合の帯
const BrewDetail: React.FC<{
  brew: LiberoBrew;
  color?: string;
  markClassName: string;
}> = ({ brew: { card, elapsedSec, plannedSec }, color, markClassName }) => {
  const backgroundColor = color ?? "#ffffff";
  const overSec = elapsedSec - plannedSec;
  return (
    <div className="flex min-w-0 flex-col gap-[1.2vh]">
      <div className="flex min-w-0 items-baseline gap-[1.2vh]">
        <span
          style={{ backgroundColor, color: readableTextColor(backgroundColor) }}
          className="truncate rounded-lg border border-slate-300 px-[1vh] font-black text-[4vh] leading-tight"
        >
          {cardItemName(card)}
        </span>
        <span className="shrink-0 font-black text-[4vh] leading-tight">
          {card.cups.length}杯
        </span>
        <span className="truncate font-bold font-mono text-[2.6vh] opacity-70">
          {orderLabel(card)}
        </span>
      </div>
      <div className="flex items-center gap-[1.2vh]">
        <div className="h-[2.4vh] flex-1 overflow-hidden rounded-full bg-slate-900/10">
          <div
            className={`h-full rounded-full ${markClassName}`}
            style={{
              width: `${Math.min(100, (elapsedSec / plannedSec) * 100)}%`,
            }}
          />
        </div>
        <span className="shrink-0 whitespace-nowrap font-bold font-mono text-[2.6vh] tabular-nums">
          予定 {clockLabel(plannedSec)}
          {overSec >= 0 && ` ＋${clockLabel(overSec)}`}
        </span>
      </div>
    </div>
  );
};
