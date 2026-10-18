import { type CaosCard, dripperLabel } from "@cafeore/common";
import { ClipboardList, ListChecks } from "lucide-react";
import type React from "react";
import type { UnassignedTab } from "../hooks/useUnfinishedTab";
import servingOverdueIcon from "../icons/serving-overdue.svg";
import { labelHasOrder, orderAndCupCounts, orderNoLabel } from "../logic/cards";
import { clockLabel } from "../logic/format";
import { type UnfinishedOrder, unfinishedStates } from "../logic/unfinished";
import { CommentList } from "./OrderComments";
import {
  RollingClock,
  RollingNumber,
  RollingOrderNumber,
} from "./RollingOrderNumber";
import { ScrollArea } from "./ScrollArea";

// 未割当の欄のタブ（「未割当」と「未提供」）と、未提供の注文の一覧（管制盤 A の下の横帯・C の右の列・D の右の注文内容で同じ）。
// 未提供は、去年までのマスターシートのように、まだ提供していない注文を注文番号の順に、受けてからの時間（15 分を超えたら赤）・今の状態・コメントで並べる。
// 行を押すとその注文を番号の検索と同じく選んで見せる。コメントにはスタンプで返せる（CommentList）。

/** 未割当の欄に「未提供」のタブを出すときに渡すもの（操作の画面だけ。閲覧だけの画面では渡さない） */
export interface UnfinishedView {
  tab: UnassignedTab;
  onSelectTab: (tab: UnassignedTab) => void;
  /** 「未提供」のタブの印の件数（まだ見ていない 15 分超の注文と新しいコメント） */
  badge: number;
  rows: readonly UnfinishedOrder[];
  /** 選んだ注文（orderLabel。その行に選択中の黄の輪） */
  selectedOrderId: string | null;
  /** 行を押した（その注文を番号の検索と同じく選んで見せる） */
  onSelectOrder: (orderNo: number) => void;
}

/** タブラベル・見出し・表示領域で共通の背景色。 */
export const unassignedAreaBackground = (view?: UnfinishedView) =>
  view?.tab === "unfinished" ? "bg-[#f5ede3]" : "bg-white";

const TAB =
  "relative flex h-12 shrink-0 touch-manipulation items-center gap-1.5 whitespace-nowrap caos-folder-tab rounded-t-lg border px-2 font-black";
const TAB_ON = "text-slate-950";
const TAB_OFF = "text-slate-600 hover:text-slate-950";

/**
 * 未割当の欄の見出し。view があれば「未割当」「未提供」のタブにし、注文番号・件数・杯数・NEXTを内部で描画する。
 * view が無ければ（閲覧だけの画面）タブにせず、題と件数・杯数を並べる。className で字の大きさ（アイコンも合わせる）
 */
export const UnassignedHeading: React.FC<{
  view?: UnfinishedView;
  unassignedOrders?: readonly CaosCard[];
  nextBayId?: number;
  /** 「未割当」のタブの名前（D は「注文内容」） */
  label?: string;
  className?: string;
}> = ({
  view,
  unassignedOrders = [],
  nextBayId,
  label = "未割当",
  className = "text-[15px]",
}) => {
  const unassignedCounts = orderAndCupCounts(unassignedOrders);
  const unassignedNumberTone =
    unassignedCounts.orders >= 10 ? "text-red-600" : "";
  const longestWaitSec = Math.max(
    0,
    ...(view?.rows.map((row) => row.waitSec) ?? []),
  );
  const longestTimeTone =
    longestWaitSec > 20 * 60
      ? "text-red-600 caos-unserved-time-blink"
      : longestWaitSec > 15 * 60
        ? "text-red-600"
        : "";
  const unservedCups = view?.rows.reduce((sum, row) => sum + row.cups, 0) ?? 0;
  const smallestUnassigned = unassignedOrders.reduce<number | null>(
    (smallest, card) =>
      card.cups.reduce<number | null>(
        (current, cup) =>
          current === null ? cup.orderNo : Math.min(current, cup.orderNo),
        smallest,
      ),
    null,
  );
  const smallestUnserved =
    view?.rows.reduce<number | null>(
      (smallest, row) =>
        smallest === null ? row.orderNo : Math.min(smallest, row.orderNo),
      null,
    ) ?? null;
  const icon = <ClipboardList className="h-[1.1em] w-[1.1em] shrink-0" />;
  if (!view)
    return (
      <>
        <h2
          className={`flex items-center gap-1.5 whitespace-nowrap font-black text-slate-950 [&>svg]:text-slate-700 ${className}`}
        >
          {icon}
          {label}
        </h2>
        <span className="caos-tab-count">
          <RollingNumber value={unassignedCounts.orders} />件{" "}
          <RollingNumber value={unassignedCounts.cups} />杯
        </span>
      </>
    );
  return (
    <div role="tablist" className={`caos-folder-tabs flex gap-1 ${className}`}>
      <button
        type="button"
        role="tab"
        aria-selected={view.tab === "unassigned"}
        onClick={() => view.onSelectTab("unassigned")}
        className={`${TAB} bg-white ${view.tab === "unassigned" ? TAB_ON : TAB_OFF}`}
      >
        {icon}
        {label}
        <span
          className="caos-tab-time"
          title="次のコーヒーを最も早く始められる担当者（現在の抽出と待機を含む予測）"
        >
          NEXT→
          {nextBayId === undefined ? (
            "—"
          ) : (
            <span className="caos-order-digits">
              <RollingNumber
                value={nextBayId}
                label={`ドリッパー ${dripperLabel(nextBayId)}`}
              />
              <span>{dripperLabel(nextBayId).replace(/^\d+/, "")}</span>
            </span>
          )}
        </span>
        <RollingOrderNumber
          value={smallestUnassigned}
          className={unassignedNumberTone}
        />
        <span className="caos-tab-count">
          <RollingNumber
            value={unassignedCounts.orders}
            className={unassignedNumberTone}
          />
          件{" "}
          <RollingNumber
            value={unassignedCounts.cups}
            className={unassignedNumberTone}
          />
          杯
        </span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={view.tab === "unfinished"}
        onClick={() => view.onSelectTab("unfinished")}
        className={`${TAB} bg-[#f5ede3] ${view.tab === "unfinished" ? TAB_ON : TAB_OFF}`}
      >
        <ListChecks className="h-[1.1em] w-[1.1em] shrink-0" />
        未提供
        <RollingOrderNumber value={smallestUnserved} />
        {view.rows.some((row) => row.late) && (
          <img
            src={servingOverdueIcon}
            alt="提供待ち15分以上"
            className="h-6 w-6 rounded-full bg-white"
          />
        )}
        <span className="caos-tab-count">
          <RollingNumber value={view.rows.length} />件{" "}
          <RollingNumber value={unservedCups} />杯
        </span>
        <span className={`caos-tab-time ${longestTimeTone}`}>
          最長 <RollingClock seconds={longestWaitSec} />
        </span>
        {view.badge > 0 && (
          <output
            aria-label={`未提供に新しい知らせ ${view.badge} 件`}
            className="-top-1 -right-2 absolute flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 font-black text-[11px] text-white leading-none"
          >
            <RollingNumber value={view.badge} label={`${view.badge}件`} />
          </output>
        )}
      </button>
    </div>
  );
};

/** 未提供の注文の 1 行。上を押すとその注文を選び、下にコメント（とスタンプ） */
const UnfinishedRow: React.FC<{
  row: UnfinishedOrder;
  selected: boolean;
  onSelect: (orderNo: number) => void;
  className: string;
}> = ({ row, selected, onSelect, className }) => (
  <article
    className={`rounded-lg border-2 bg-white p-1.5 ${row.late ? "border-red-500" : "border-slate-300"} ${selected ? "ring-4 ring-amber-400" : ""} ${className}`}
  >
    <button
      type="button"
      onClick={() => onSelect(row.orderNo)}
      className="flex w-full touch-manipulation flex-wrap items-center gap-x-2 gap-y-1 text-left"
    >
      <span className="font-black font-mono text-[24px] text-slate-950 leading-none">
        {orderNoLabel(row.orderNo)}
      </span>
      <span
        title="受けてからの時間"
        className={`rounded-md px-1.5 py-0.5 font-black font-mono text-[22px] leading-none ${row.late ? "bg-red-600 text-white" : "bg-slate-100 text-slate-900"}`}
      >
        {clockLabel(row.waitSec)}
      </span>
      {row.late && (
        <img
          src={servingOverdueIcon}
          alt="提供待ち15分以上"
          className="h-7 w-7 rounded-full bg-white"
        />
      )}
      {row.emergency && (
        <span className="rounded-md border-2 border-red-800 bg-red-600 px-1.5 font-black text-[12px] text-white">
          緊急
        </span>
      )}
      <span className="flex flex-wrap gap-1">
        {unfinishedStates(row).map((label) => (
          <span
            key={label}
            className="whitespace-nowrap rounded-md border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-bold text-[12px] text-slate-800"
          >
            {label}
          </span>
        ))}
      </span>
    </button>
    <CommentList comments={row.comments} className="mt-1.5" />
  </article>
);

// 横に並べる（管制盤 A の横帯）か、縦に並べる（C・D の右の列）か
const LIST_LAYOUT = {
  x: {
    scroller: "overscroll-x-contain",
    list: "flex h-full w-max min-w-full items-start gap-2 px-2 pt-1.5 pb-2",
    row: "max-h-full w-[240px] shrink-0 overflow-y-auto",
  },
  y: {
    scroller: "overscroll-contain",
    list: "grid auto-rows-max content-start gap-1.5 p-2 pb-8",
    row: "",
  },
} as const;

/**
 * 未提供の注文の一覧。axis が x なら注文を左から横に並べ（管制盤 A の横帯。スクロールバーは見出しの trackSlot）、y なら上から縦に並べる（C・D の右の列）
 */
export const UnfinishedList: React.FC<{
  view: UnfinishedView;
  axis: keyof typeof LIST_LAYOUT;
  trackSlot?: HTMLElement | null;
}> = ({ view, axis, trackSlot }) => {
  const layout = LIST_LAYOUT[axis];
  return (
    <ScrollArea
      axis={axis}
      trackSlot={trackSlot}
      className="flex-1"
      scrollerClassName={layout.scroller}
    >
      <div className={layout.list}>
        {view.rows.map((row) => (
          <UnfinishedRow
            key={row.orderId}
            row={row}
            selected={labelHasOrder(view.selectedOrderId, row.orderNo)}
            onSelect={view.onSelectOrder}
            className={layout.row}
          />
        ))}
        {view.rows.length === 0 && <EmptyNote />}
      </div>
    </ScrollArea>
  );
};

const EmptyNote: React.FC = () => (
  <div className="w-full rounded-md border border-dashed py-8 text-center text-slate-400 text-xs">
    まだ提供していない注文はありません
  </div>
);
