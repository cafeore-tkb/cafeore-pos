import { RotateCcw, Sparkles, X } from "lucide-react";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Barista, BeanCode, OrderTicket } from "../types";
import { BayLaneRow } from "./BayLaneRow";

interface DispatchBoardProps {
  baristas: Barista[];
  highlightFilter: BeanCode | null;
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
  simTimeSec: number;
  timelineCommand: { direction: "back" | "now" | "forward"; id: number } | null;
  /** 閲覧だけの画面。各列の「次へ」と空きスロットを出さない */
  readOnly?: boolean;
}

const PIXELS_PER_SEC = 1.2; // 1 min = 72px
const STICKY_LEFT_WIDTH = 290; // 195px barista + 95px action
// 90 seconds of past context remains visible to the left of NOW.
const NOW_VIEWPORT_OFFSET = 90 * PIXELS_PER_SEC;
// Scroll positions this close to NOW count as following it.
const FOLLOW_TOLERANCE_PX = 24;
// Scrolled this far behind NOW, the board shows the past-history banner.
const PAST_VIEW_THRESHOLD_PX = 600;

export const DispatchBoard: React.FC<DispatchBoardProps> = ({
  baristas,
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
  simTimeSec,
  timelineCommand,
  readOnly = false,
}) => {
  // Build a rolling timeline that runs 12 hours ahead of the current hour. It starts
  // one hour back so drips spanning the top of the hour keep their real position.
  const timelineStartSec = Math.floor(simTimeSec / 3600) * 3600 - 3600;
  const timelineEndSec = timelineStartSec + 13 * 3600;
  const timelineWidthPx = (timelineEndSec - timelineStartSec) * PIXELS_PER_SEC;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // The board follows NOW until the viewer scrolls (or pages with ±5分) away from it,
  // and stays where they left it until they come back or press 現在.
  const [isFollowingNow, setIsFollowingNow] = useState(true);
  const [isScrolledToPast, setIsScrolledToPast] = useState(false);

  const _formatClock = (seconds: number) => {
    const normalized = ((seconds % 86400) + 86400) % 86400;
    const hours = Math.floor(normalized / 3600);
    const minutes = Math.floor((normalized % 3600) / 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
  };

  // Position of current NOW cursor along timeline
  const nowX = (simTimeSec - timelineStartSec) * PIXELS_PER_SEC;
  const followLeftPx = Math.max(0, nowX - NOW_VIEWPORT_OFFSET);
  const isPastView = !isFollowingNow && isScrolledToPast;
  const followLeftRef = useRef(followLeftPx);
  followLeftRef.current = followLeftPx;

  // When the hour rolls over the track origin moves; shift the scroll by the same
  // amount before paint so whatever is on screen stays put.
  const previousTimelineStartRef = useRef(timelineStartSec);
  useLayoutEffect(() => {
    const shiftPx =
      (timelineStartSec - previousTimelineStartRef.current) * PIXELS_PER_SEC;
    previousTimelineStartRef.current = timelineStartSec;
    if (shiftPx && scrollContainerRef.current)
      scrollContainerRef.current.scrollLeft -= shiftPx;
  }, [timelineStartSec]);

  // Keep NOW at one fixed screen position; the timeline moves underneath it.
  useLayoutEffect(() => {
    if (!scrollContainerRef.current || !isFollowingNow) return;
    scrollContainerRef.current.scrollLeft = followLeftPx;
  }, [followLeftPx, isFollowingNow]);

  // Leave follow mode as soon as the view moves away, but resume only once scrolling
  // has settled near NOW so a scroll that merely passes NOW is not captured.
  const followSettleTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(followSettleTimerRef.current), []);
  // ±5分 starts a smooth scroll that begins slowly; don't mistake its first frames near NOW for a stop.
  const pagingUntilRef = useRef(0);
  const scheduleFollowCheck = (leftAtSchedule: number) => {
    followSettleTimerRef.current = window.setTimeout(() => {
      if (performance.now() < pagingUntilRef.current) {
        scheduleFollowCheck(leftAtSchedule);
        return;
      }
      const settledLeft = scrollContainerRef.current?.scrollLeft;
      if (
        settledLeft !== undefined &&
        Math.abs(settledLeft - leftAtSchedule) < 1 &&
        Math.abs(settledLeft - followLeftRef.current) <= FOLLOW_TOLERANCE_PX
      ) {
        setIsFollowingNow(true);
      }
    }, 150);
  };
  // While browsing, NOW keeps moving away from a still view; re-check the banner each tick.
  useEffect(() => {
    if (isFollowingNow || !scrollContainerRef.current) return;
    setIsScrolledToPast(
      scrollContainerRef.current.scrollLeft < nowX - PAST_VIEW_THRESHOLD_PX,
    );
  }, [nowX, isFollowingNow]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const currentLeft = scrollContainerRef.current.scrollLeft;
    // A boolean, so scrolling re-renders the board only when it crosses the threshold.
    setIsScrolledToPast(currentLeft < nowX - PAST_VIEW_THRESHOLD_PX);
    window.clearTimeout(followSettleTimerRef.current);
    if (Math.abs(currentLeft - followLeftPx) > FOLLOW_TOLERANCE_PX) {
      setIsFollowingNow(false);
      return;
    }
    scheduleFollowCheck(currentLeft);
  };

  // Run each header command once. ±5分 pages from the current view; 現在 returns to NOW,
  // and arriving there resumes following through handleScroll.
  const handledCommandIdRef = useRef(timelineCommand?.id);
  useEffect(() => {
    if (!timelineCommand || timelineCommand.id === handledCommandIdRef.current)
      return;
    handledCommandIdRef.current = timelineCommand.id;
    const container = scrollContainerRef.current;
    if (!container) return;
    const pagePx = 300 * PIXELS_PER_SEC;
    // Stop following first so the next clock tick does not cut the smooth scroll short.
    if (timelineCommand.direction !== "now") {
      setIsFollowingNow(false);
      pagingUntilRef.current = performance.now() + 1000;
    }
    const left =
      timelineCommand.direction === "now"
        ? followLeftRef.current
        : container.scrollLeft +
          (timelineCommand.direction === "back" ? -pagePx : pagePx);
    container.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [timelineCommand]);

  // Generate timeline markers every 1 minute, with major labels every 5 minutes
  const timeMarkers = [];
  for (let sec = timelineStartSec; sec <= timelineEndSec; sec += 60) {
    const clockSec = ((sec % 86400) + 86400) % 86400;
    const m = Math.floor(clockSec / 60) % 60;
    const h = Math.floor(clockSec / 3600);
    const isMajor = m % 5 === 0;
    const left = (sec - timelineStartSec) * PIXELS_PER_SEC;

    timeMarkers.push({
      sec,
      timeStr: `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`,
      minuteStr: `:${m.toString().padStart(2, "0")}`,
      isMajor,
      isHour: m === 0,
      left,
    });
  }

  // Find all cards matching selectedOrderId to summarize
  const matchingTickets: {
    baristaName: string;
    beanName: string;
    cupCount: number;
    bayNumber: number;
  }[] = [];
  if (selectedOrderId) {
    baristas.forEach((b) => {
      [...(b.pastTickets || []), ...b.queue].forEach((t) => {
        if (t.id === selectedOrderId) {
          matchingTickets.push({
            baristaName: b.name,
            bayNumber: b.bayNumber,
            beanName: t.beanName,
            cupCount: t.cupCount,
          });
        }
      });
    });
  }

  return (
    <div className="relative flex shrink-0 flex-col overflow-hidden rounded-lg border border-[#cbd5e1] bg-white shadow-xs">
      {isPastView && (
        <div className="flex h-[28px] items-center gap-1 border-amber-200 border-b bg-amber-50 px-3 font-bold text-[11px] text-amber-900">
          <RotateCcw className="h-3 w-3" />
          <span>過去の抽出履歴を表示中</span>
        </div>
      )}

      {/* 2. Linked Order Highlight Banner (when an order is selected) */}
      {selectedOrderId && (
        <div className="flex h-[42px] select-none items-center justify-between bg-amber-500 px-3 font-bold text-white text-xs shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-black font-mono text-[20px]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{selectedOrderId}</span>
            </span>
            <span>連動:</span>
            <span className="rounded bg-amber-600/90 px-2 py-0.5 font-normal text-amber-100">
              {matchingTickets.length > 0
                ? matchingTickets
                    .map(
                      (m) =>
                        `ドリッパー ${m.bayNumber} ${m.baristaName}: ${m.beanName} ${m.cupCount}杯`,
                    )
                    .join(" ＋ ")
                : "オーダー詳細表示"}
            </span>
          </div>

          <button
            onClick={() => onSelectOrder("")}
            className="flex min-h-[34px] min-w-[52px] cursor-pointer touch-manipulation items-center justify-center gap-1 rounded-lg bg-amber-700 px-2 font-bold text-[11px] transition-colors hover:bg-amber-800"
          >
            <X className="h-3.5 w-3.5" />
            <span>解除</span>
          </button>
        </div>
      )}

      {/* 3. Master Synchronized Horizontal Scroll Container */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="touch-auto select-none overflow-x-auto overflow-y-hidden overscroll-x-contain"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div
          className="relative"
          style={{ width: `${STICKY_LEFT_WIDTH + timelineWidthPx}px` }}
        >
          {/* 3A. Synchronized Timeline Scale Header */}
          <div className="relative flex h-[30px] items-center border-[#e2e8f0] border-b bg-[#f8fafc] font-medium font-mono text-[11px] text-slate-500">
            {/* Sticky Left Header Cell (290px = 95px Action + 195px Barista) */}
            <div className="sticky left-0 isolate z-[60] flex h-full w-[290px] shrink-0 items-center border-[#cbd5e1] border-r bg-[#f8fafc] font-bold font-sans text-[11px] text-slate-500 shadow-[4px_0_10px_rgba(15,23,42,0.08)]">
              <span className="w-[95px] px-3 text-center">操作</span>
              <span className="w-[195px] border-slate-200 border-l px-3">
                ドリッパー / 抽出担当
              </span>
            </div>

            {/* Scrollable Ruler Track with Ticks & Labels */}
            <div
              className="relative h-full"
              style={{ width: `${timelineWidthPx}px` }}
            >
              {timeMarkers.map((marker) => (
                <div
                  key={marker.sec}
                  className="absolute top-0 bottom-0 flex flex-col justify-between"
                  style={{ left: `${marker.left}px` }}
                >
                  <div
                    className={`h-[7px] ${
                      marker.isHour
                        ? "h-[12px] w-[2px] bg-slate-700"
                        : marker.isMajor
                          ? "h-[10px] w-[1px] bg-slate-400"
                          : "w-[1px] bg-slate-300"
                    }`}
                  />
                  {marker.isMajor ? (
                    <span className="-translate-x-1/2 font-bold text-[11px] text-slate-800">
                      {marker.timeStr}
                    </span>
                  ) : (
                    <span className="-translate-x-1/2 text-[9px] text-slate-400">
                      {marker.minuteStr}
                    </span>
                  )}
                  <div
                    className={`h-[7px] ${
                      marker.isHour
                        ? "h-[12px] w-[2px] bg-slate-700"
                        : marker.isMajor
                          ? "h-[10px] w-[1px] bg-slate-400"
                          : "w-[1px] bg-slate-300"
                    }`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* 3B. Synchronized Bay Rows Container */}
          <div className="relative divide-y divide-[#e2e8f0]">
            {[...baristas]
              .sort((a, b) => a.bayNumber - b.bayNumber)
              .map((barista) => (
                <BayLaneRow
                  key={barista.id}
                  barista={barista}
                  highlightFilter={highlightFilter}
                  selectedOrderId={selectedOrderId}
                  onSelectOrder={onSelectOrder}
                  onAdvanceBay={onAdvanceBay}
                  onOpenTicketDetail={onOpenTicketDetail}
                  actionTicketKey={actionTicketKey}
                  onMoveTicket={onMoveTicket}
                  onReturnToUnassigned={onReturnToUnassigned}
                  onCloseTicketAction={onCloseTicketAction}
                  onRequestRebrew={onRequestRebrew}
                  onOpenEmptySlot={onOpenEmptySlot}
                  readOnly={readOnly}
                  timelineStartSec={timelineStartSec}
                  pixelsPerSec={PIXELS_PER_SEC}
                  timelineWidthPx={timelineWidthPx}
                  simTimeSec={simTimeSec}
                />
              ))}
          </div>
          {timeMarkers
            .filter((marker) => marker.isHour)
            .map((marker) => (
              <div
                key={`hour-line-${marker.sec}`}
                className="pointer-events-none absolute top-[30px] bottom-0 z-20 w-[2px] bg-slate-500/70"
                style={{ left: `${STICKY_LEFT_WIDTH + marker.left}px` }}
                aria-hidden="true"
              />
            ))}
          {/* Drawn on the track so it marks the real time even while browsing away from NOW. */}
          <div
            className="pointer-events-none absolute top-[44px] bottom-0 z-40 w-[2px] bg-red-500"
            style={{ left: `${STICKY_LEFT_WIDTH + nowX}px` }}
            aria-hidden="true"
          >
            <div className="-translate-x-1/2 absolute top-1 rounded-md bg-red-500 px-2 py-0.5 font-black text-[10px] text-white shadow-sm">
              NOW
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
