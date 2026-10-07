import { CHANGEOVER_SEC, IMMINENT_SEC, formatMinSec } from "@cafeore/common";
import { ArrowRightCircle, Plus } from "lucide-react";
import type React from "react";
import type { Barista, OrderTicket } from "../types";
import { laneOrdinal, laneTitle } from "../utils/lanes";
import { LaneName } from "./LaneName";
import { TicketCard } from "./TicketCard";

interface BayLaneRowProps {
  barista: Barista;
  // 豆で絞り込む（盤面のカードは在庫対象の ID、実データテストのカードは豆のコード）
  highlightFilter: string | null;
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
  onAdvanceBay: (bayId: number) => void;
  onOpenTicketDetail: (ticket: OrderTicket) => void;
  actionTicketKey?: string | null;
  onMoveTicket: (ticket: OrderTicket, bayId: number) => void;
  onReturnToUnassigned: (ticket: OrderTicket) => void;
  onCloseTicketAction: () => void;
  onRequestRebrew: (ticket: OrderTicket, bayId: number) => void;
  onOpenEmptySlot: (bayId: number) => void;
  timelineStartSec: number;
  pixelsPerSec: number;
  timelineWidthPx: number;
  simTimeSec: number;
  /** 閲覧だけの画面（/master-sheet/view）。「次へ」と空きスロットを出さない */
  readOnly?: boolean;
  /** 列の「交代」。無ければ（閲覧だけ・実データテスト中）番号だけを出す */
  onChangeLane?: (bayId: number) => void;
}

export const BayLaneRow: React.FC<BayLaneRowProps> = ({
  barista,
  highlightFilter,
  selectedOrderId,
  onSelectOrder,
  onAdvanceBay,
  onOpenTicketDetail,
  actionTicketKey,
  onMoveTicket,
  onReturnToUnassigned,
  onCloseTicketAction,
  onRequestRebrew,
  onOpenEmptySlot,
  timelineStartSec,
  pixelsPerSec,
  timelineWidthPx,
  simTimeSec,
  readOnly = false,
  onChangeLane,
}) => {
  const ordinal = laneOrdinal(barista.bayNumber);
  // Determine if active ticket is imminent (<15s or flagged imminent)
  const activeTicket = barista.queue[0];
  const isImminent =
    barista.status === "imminent" ||
    (activeTicket &&
      activeTicket.status === "brewing" &&
      (activeTicket.timeRemainingSec ?? 999) <= IMMINENT_SEC);
  const isOvertime = Boolean(
    activeTicket &&
      activeTicket.status === "brewing" &&
      activeTicket.timeRemainingSec === 0,
  );
  const formatRemaining = (seconds?: number) =>
    seconds === undefined ? "--:--" : formatMinSec(seconds);

  // Combine past completed tickets and current queue for full timeline view
  const allTickets: OrderTicket[] = [
    ...(barista.pastTickets || []).map((t) => ({
      ...t,
      status: "completed" as const,
    })),
    ...barista.queue,
  ];

  let queueCursorSec: number | null = null;
  const positionedTickets = allTickets.map((ticket) => {
    let startSec = ticket.startTimeSec ?? timelineStartSec + 855;
    if (queueCursorSec !== null && ticket.status !== "completed")
      startSec = Math.max(startSec, queueCursorSec + CHANGEOVER_SEC);
    const plannedEndSec = startSec + ticket.totalDurationSec;
    const endSec =
      ticket === activeTicket
        ? Math.max(plannedEndSec, simTimeSec)
        : plannedEndSec;
    if (ticket.status !== "completed") queueCursorSec = endSec;
    return { ticket, startSec, endSec };
  });

  // Place the Empty Slot button after the last ticket, but never behind NOW where
  // it would scroll out of view on an idle lane.
  const lastTicketEndSec =
    positionedTickets[positionedTickets.length - 1]?.endSec ?? simTimeSec;
  const emptySlotLeftPx =
    (Math.max(lastTicketEndSec, simTimeSec) - timelineStartSec) * pixelsPerSec +
    16;

  return (
    <div
      data-bay-target={barista.id}
      className="relative flex h-[72px] touch-manipulation items-center border-[#e2e8f0] border-b bg-white transition-colors hover:bg-[#fcfdff]"
    >
      {/* 1. Dripper information - stable locator on the far left */}
      <div className="sticky left-0 isolate z-[51] flex w-[195px] shrink-0 items-center gap-2 self-stretch border-[#e2e8f0] border-r bg-white px-2 py-1.5">
        {/* 列の番号（1st〜6th）。押すと交代（担当者を替える） */}
        {onChangeLane && !readOnly ? (
          <button
            type="button"
            data-lane-change={barista.id}
            onClick={() => onChangeLane(barista.id)}
            title={`${laneTitle(barista)}の交代`}
            className="flex h-[56px] w-10 shrink-0 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-lg border border-slate-300 bg-slate-100 text-slate-700 active:scale-95 active:bg-slate-200"
          >
            <span className="font-bold font-mono text-[13px] leading-none">
              {ordinal}
            </span>
            <span className="rounded bg-white px-1 py-0.5 font-black text-[10px] leading-none">
              交代
            </span>
          </button>
        ) : (
          <div className="flex h-9 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-300 bg-slate-100 font-bold font-mono text-[13px] text-slate-600">
            {ordinal}
          </div>
        )}

        <div className="flex h-full min-w-0 flex-1 flex-col justify-center">
          <div className="flex min-w-0 items-center gap-1 leading-none">
            <LaneName
              barista={barista}
              className="font-black text-[#0f172a] text-[15px] tracking-tight"
            />
            {activeTicket && (
              <span className="ml-auto shrink-0 font-black font-mono text-[16px] text-slate-950">
                {activeTicket.id}
              </span>
            )}
          </div>

          <div className="mt-1 flex min-w-0 items-center gap-1 leading-none">
            <span
              className="truncate font-bold text-[13px] text-slate-800"
              title={activeTicket?.beanName}
            >
              {activeTicket?.beanName || "待機中"}
            </span>
            {activeTicket && (
              <span className="shrink-0 rounded bg-slate-950 px-1.5 py-0.5 font-black font-mono text-[12px] text-white">
                {activeTicket.cupCount}杯
              </span>
            )}
          </div>
          <div
            className={`mt-1 flex items-baseline gap-1 font-black font-mono leading-none ${isImminent ? "text-red-600" : "text-slate-950"}`}
          >
            {activeTicket && !isOvertime && (
              <span className="font-black font-sans text-[9px] tracking-wide">
                残り
              </span>
            )}
            <span className={isOvertime ? "text-[17px]" : "text-[21px]"}>
              {activeTicket
                ? isOvertime
                  ? "継続中"
                  : formatRemaining(activeTicket.timeRemainingSec)
                : "--:--"}
            </span>
          </div>
        </div>
      </div>

      {/* 2. Operation - immediately to the right of the dripper */}
      <div className="sticky left-[195px] isolate z-50 flex w-[95px] shrink-0 items-center justify-center self-stretch border-[#cbd5e1] border-r bg-white px-2 shadow-[4px_0_10px_rgba(15,23,42,0.08)]">
        {!readOnly && (
          <button
            id={`bay-action-btn-${barista.id}`}
            disabled={barista.queue.length === 0}
            onClick={() => onAdvanceBay(barista.id)}
            className={`flex min-h-[48px] w-full touch-manipulation items-center justify-center gap-1.5 rounded-lg font-black text-[15px] shadow-xs active:scale-95 ${barista.queue.length === 0 ? "bg-slate-200 text-slate-500" : isImminent ? "bg-amber-500 text-slate-950 ring-2 ring-amber-200" : "bg-[#006c4a] text-white"}`}
            title={`${laneTitle(barista)}の現在の抽出を確定して次へ`}
          >
            <span>{barista.queue.length === 0 ? "待機" : "次へ"}</span>
            <ArrowRightCircle className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* 3. Timeline Track with Ticket Queue scaled by duration */}
      <div
        className="relative h-[72px] py-1.5"
        style={{ width: `${timelineWidthPx}px` }}
      >
        {positionedTickets.map(({ ticket, startSec, endSec }) => {
          // Drips that ended before the track starts would otherwise pile up at its left edge.
          if (endSec <= timelineStartSec) return null;
          const leftPx = Math.max(
            10,
            (startSec - timelineStartSec) * pixelsPerSec,
          );
          const widthPx = Math.max(130, (endSec - startSec) * pixelsPerSec);

          return (
            <div
              key={ticket.ticketUid || `${ticket.id}-${ticket.itemIndex || 1}`}
              className="absolute top-1.5 bottom-1.5"
              style={{
                left: `${leftPx}px`,
                width: `${widthPx}px`,
              }}
            >
              <TicketCard
                ticket={ticket}
                highlightFilter={highlightFilter}
                selectedOrderId={selectedOrderId}
                onSelectOrder={onSelectOrder}
                onOpenDetail={onOpenTicketDetail}
                actionTicketKey={actionTicketKey}
                currentBayId={barista.id}
                onMoveTicket={onMoveTicket}
                onReturnToUnassigned={onReturnToUnassigned}
                onCloseAction={onCloseTicketAction}
                onRequestRebrew={(selected) =>
                  onRequestRebrew(selected, barista.id)
                }
                widthPx={widthPx}
              />
            </div>
          );
        })}

        {/* Empty Slot Button positioned after the last scheduled ticket */}
        {!readOnly && (
          <div
            className="absolute top-1.5 bottom-1.5"
            style={{ left: `${emptySlotLeftPx}px` }}
          >
            <button
              id={`empty-slot-bay-${barista.id}`}
              onClick={() => onOpenEmptySlot(barista.id)}
              className="group flex h-full min-w-[130px] cursor-pointer touch-manipulation select-none items-center justify-center gap-1.5 rounded-lg border-2 border-[#cbd5e1] border-dashed bg-[#f8fafc] px-3 font-bold text-[#64748b] text-[12.5px] transition-all hover:border-blue-400 hover:text-blue-600 active:bg-blue-100/70"
              title="タップして未割当オーダーをこのドリッパーに割り当て"
            >
              <Plus className="h-4 w-4 text-slate-500 transition-transform group-hover:scale-110" />
              <span>空きスロット</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
