import { RotateCcw, Sparkles, X } from "lucide-react";
import type React from "react";
import { bayTargetAt, useCardDrag } from "../hooks/useCardDrag";
import { useOutsidePress } from "../hooks/useOutsidePress";
import { useTimelineScroll } from "../hooks/useTimelineScroll";
import { ticketsWhere } from "../logic/board";
import { type OrderTicket, orderLabel } from "../logic/cards";
import { clockLabel } from "../logic/format";
import { laneOrdinal } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
import { positionTickets, timeMarkers, timelineRange } from "../logic/timeline";
import { EmptySlotButton, LaneBadge, NextButton } from "./BoardParts";
import type { ControlViewProps } from "./ControlWorkspace";
import { BayPad, OrderCard } from "./OrderCard";

// 管制盤 A のタイムライン。6 列（1st〜6th）の抽出中・待機・終わったカードを、時刻の位置に並べる。
// 待機のカードはタップで 1〜6 のボタン（もう一度タップで未割当に戻す）、列へのドラッグで移す。
// 抽出中・終わったカードはタップで緊急の入れ直し。

const PIXELS_PER_SEC = 1.2; // 1 min = 72px
const STICKY_LEFT_WIDTH = 290; // 195px barista + 95px action
// 90 seconds of past context remains visible to the left of NOW.
const NOW_VIEWPORT_OFFSET = 90 * PIXELS_PER_SEC;

// 列の残り時間（カードが無ければ「--:--」、予定を過ぎたら「継続中」）
const remainingText = (lane: ReturnType<typeof laneStatus>) => {
  if (!lane.current) return "--:--";
  if (lane.overtime) return "継続中";
  return clockLabel(lane.remainingSec);
};

const tickClass = (marker: { isHour: boolean; isMajor: boolean }) => {
  if (marker.isHour) return "h-[12px] w-[2px] bg-slate-700";
  if (marker.isMajor) return "h-[10px] w-[1px] bg-slate-400";
  return "h-[7px] w-[1px] bg-slate-300";
};

export const DispatchBoard: React.FC<
  Omit<
    ControlViewProps,
    "unassignedOrders" | "nextAvailable" | "onAssignToBay" | "onMergeOrders"
  >
> = ({
  baristas,
  selectedOrderId,
  onSelectOrder,
  onAdvanceBay,
  onOpenTicketPad,
  actionTicketKey,
  onMoveTicket,
  onReturnToUnassigned,
  onCloseTicketAction,
  onRequestRebrew,
  onOpenEmptySlot,
  currentTimeSec,
  timelineCommand,
}) => {
  const range = timelineRange(currentTimeSec);
  const timelineWidthPx = (range.endSec - range.startSec) * PIXELS_PER_SEC;
  // Position of current NOW cursor along timeline
  const nowX = (currentTimeSec - range.startSec) * PIXELS_PER_SEC;
  const scroll = useTimelineScroll({
    nowX,
    followLeftPx: Math.max(0, nowX - NOW_VIEWPORT_OFFSET),
    originPx: range.startSec * PIXELS_PER_SEC,
    pagePx: 300 * PIXELS_PER_SEC,
    command: timelineCommand,
  });
  const markers = timeMarkers(range.startSec, range.endSec);
  const toX = (sec: number) => (sec - range.startSec) * PIXELS_PER_SEC;

  // 待機のカードを別の列へ（今の列と、指名以外の列には置けない）
  const drag = useCardDrag<{ ticket: OrderTicket; bayId: number }, number>({
    targetAt: ({ ticket, bayId }, x, y) => bayTargetAt(x, y, ticket, bayId),
    onDrop: ({ ticket }, bayId) => {
      onMoveTicket(ticket, bayId);
      onCloseTicketAction();
    },
  });

  // 1〜6 のボタンを開いたカードの外を押すと閉じる
  useOutsidePress(
    actionTicketKey !== null,
    (target) =>
      target.closest<HTMLElement>("[data-ticket-uid]")?.dataset.ticketUid ===
      actionTicketKey,
    onCloseTicketAction,
  );

  // 選んだ注文のカード（列ごと）
  const matchingTickets = ticketsWhere(
    baristas,
    (ticket) => orderLabel(ticket) === selectedOrderId,
  ).map(
    ({ ticket, bayId }) =>
      `ドリッパー ${laneOrdinal(bayId)}: ${ticket.beanName} ${ticket.cupCount}杯`,
  );

  return (
    <div className="relative flex shrink-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
      {scroll.isPastView && (
        <div className="flex h-[28px] items-center gap-1 border-amber-200 border-b bg-amber-50 px-3 font-bold text-[11px] text-amber-900">
          <RotateCcw className="h-3 w-3" />
          <span>過去の抽出履歴を表示中</span>
        </div>
      )}

      {/* 選んだ注文（同じ注文のカードがどの列にあるか） */}
      {selectedOrderId && (
        <div className="flex h-[42px] select-none items-center justify-between bg-amber-500 px-3 font-bold text-white text-xs shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1 rounded bg-amber-600 px-2 py-0.5 font-black font-mono text-[20px]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{selectedOrderId}</span>
            </span>
            <span>連動:</span>
            <span className="rounded bg-amber-600/90 px-2 py-0.5 font-normal text-amber-100">
              {matchingTickets.join(" ＋ ") || "オーダー詳細表示"}
            </span>
          </div>

          <button
            type="button"
            onClick={() => onSelectOrder(null)}
            className="flex min-h-[34px] min-w-[52px] cursor-pointer touch-manipulation items-center justify-center gap-1 rounded-lg bg-amber-700 px-2 font-bold text-[11px] transition-colors hover:bg-amber-800"
          >
            <X className="h-3.5 w-3.5" />
            <span>解除</span>
          </button>
        </div>
      )}

      <div
        ref={scroll.containerRef}
        onScroll={scroll.onScroll}
        className="touch-auto select-none overflow-x-auto overflow-y-hidden overscroll-x-contain"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div
          className="relative"
          style={{ width: `${STICKY_LEFT_WIDTH + timelineWidthPx}px` }}
        >
          {/* 時刻の目盛り */}
          <div className="relative flex h-[30px] items-center border-slate-200 border-b bg-slate-50 font-medium font-mono text-[11px] text-slate-500">
            <div className="sticky left-0 isolate z-[60] flex h-full w-[290px] shrink-0 items-center border-slate-300 border-r bg-slate-50 font-bold font-sans text-[11px] text-slate-500 shadow-[4px_0_10px_rgba(15,23,42,0.08)]">
              <span className="w-[95px] px-3 text-center">操作</span>
              <span className="w-[195px] border-slate-200 border-l px-3">
                ドリッパー / 抽出担当
              </span>
            </div>
            <div
              className="relative h-full"
              style={{ width: `${timelineWidthPx}px` }}
            >
              {markers.map((marker) => (
                <div
                  key={marker.sec}
                  className="absolute top-0 bottom-0 flex flex-col justify-between"
                  style={{ left: `${toX(marker.sec)}px` }}
                >
                  <div className={tickClass(marker)} />
                  {marker.isMajor ? (
                    <span className="-translate-x-1/2 font-bold text-[11px] text-slate-800">
                      {marker.timeStr}
                    </span>
                  ) : (
                    <span className="-translate-x-1/2 text-[9px] text-slate-400">
                      {marker.minuteStr}
                    </span>
                  )}
                  <div className={tickClass(marker)} />
                </div>
              ))}
            </div>
          </div>

          {/* 6 列 */}
          <div className="relative divide-y divide-slate-200">
            {baristas.map((barista) => {
              const lane = laneStatus(barista);
              const { positioned, freeFromSec } = positionTickets(
                barista,
                currentTimeSec,
              );

              return (
                <div
                  key={barista.id}
                  data-bay-target={barista.id}
                  className="relative flex h-[72px] touch-manipulation items-center bg-white"
                >
                  {/* 列の番号と、抽出中のカード・残り */}
                  <div className="sticky left-0 isolate z-[51] flex w-[195px] shrink-0 items-center gap-2 self-stretch border-slate-200 border-r bg-white px-2 py-1.5">
                    <LaneBadge bayId={barista.id} />
                    <div className="flex h-full min-w-0 flex-1 flex-col justify-center leading-none">
                      {lane.current && (
                        <span className="ml-auto font-black font-mono text-[16px] text-slate-950">
                          {orderLabel(lane.current)}
                        </span>
                      )}
                      <div className="mt-1 flex min-w-0 items-center gap-1">
                        <span
                          className="truncate font-bold text-[13px] text-slate-800"
                          title={lane.current?.beanName}
                        >
                          {lane.current?.beanName || "待機中"}
                        </span>
                        {lane.current && (
                          <span className="shrink-0 rounded bg-slate-950 px-1.5 py-0.5 font-black font-mono text-[12px] text-white">
                            {lane.current.cupCount}杯
                          </span>
                        )}
                      </div>
                      <div
                        className={`mt-1 flex items-baseline gap-1 font-black font-mono ${lane.soon ? "text-red-600" : "text-slate-950"}`}
                      >
                        {lane.current && !lane.overtime && (
                          <span className="font-sans text-[9px] tracking-wide">
                            残り
                          </span>
                        )}
                        <span
                          className={
                            lane.overtime ? "text-[17px]" : "text-[21px]"
                          }
                        >
                          {remainingText(lane)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* 次へ */}
                  <div className="sticky left-[195px] isolate z-50 flex w-[95px] shrink-0 items-center justify-center self-stretch border-slate-300 border-r bg-white px-2 shadow-[4px_0_10px_rgba(15,23,42,0.08)]">
                    <NextButton
                      bayId={barista.id}
                      active={Boolean(lane.current)}
                      soon={lane.soon}
                      onAdvance={onAdvanceBay}
                      className="min-h-[48px] w-full text-[15px]"
                    />
                  </div>

                  {/* カードを時刻の位置に（幅は抽出時間） */}
                  <div
                    className="relative h-[72px] [&>*]:absolute [&>*]:top-1.5 [&>*]:bottom-1.5"
                    style={{ width: `${timelineWidthPx}px` }}
                  >
                    {positioned.map(({ ticket, startSec, endSec }) => {
                      // Drips that ended before the track starts would otherwise pile up at its left edge.
                      if (endSec <= range.startSec) return null;
                      const isScheduled = ticket.status === "scheduled";
                      const isActionOpen =
                        isScheduled && actionTicketKey === ticket.ticketUid;
                      return (
                        <div
                          key={ticket.ticketUid}
                          className={isActionOpen ? "z-[80]" : undefined}
                          style={{
                            left: Math.max(10, toX(startSec)),
                            width: Math.max(
                              130,
                              (endSec - startSec) * PIXELS_PER_SEC,
                            ),
                          }}
                        >
                          <OrderCard
                            card={ticket}
                            done={ticket.status === "completed"}
                            interrupted={ticket.isInterrupted}
                            brewing={ticket.status === "brewing"}
                            selected={selectedOrderId === orderLabel(ticket)}
                            data-ticket-uid={ticket.ticketUid}
                            onPointerDown={
                              isScheduled
                                ? (event) =>
                                    drag.press(
                                      { ticket, bayId: barista.id },
                                      event,
                                    )
                                : undefined
                            }
                            onClickCapture={drag.suppressClick}
                            onClick={() => {
                              if (!isScheduled) onRequestRebrew(ticket);
                              else if (!isActionOpen) onOpenTicketPad(ticket);
                              else {
                                onReturnToUnassigned(ticket);
                                onCloseTicketAction();
                              }
                            }}
                            className={`h-full border-l-[5px] border-l-slate-400 hover:shadow-md ${isScheduled ? "cursor-grab touch-none active:cursor-grabbing" : "touch-manipulation"}`}
                            dragging={
                              drag.source?.ticket.ticketUid === ticket.ticketUid
                            }
                          >
                            {isActionOpen && (
                              <>
                                <BayPad
                                  card={ticket}
                                  currentBayId={barista.id}
                                  hoveredBay={drag.target}
                                  onPick={(bayId) => {
                                    onMoveTicket(ticket, bayId);
                                    onCloseTicketAction();
                                  }}
                                />
                                <div className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center rounded-md bg-red-500/10">
                                  <X className="h-10 w-10 stroke-[3] text-red-600/35" />
                                </div>
                              </>
                            )}
                          </OrderCard>
                        </div>
                      );
                    })}

                    {/* 空きスロット（最後のカードの後ろ。NOW より前には置かない） */}
                    <div
                      style={{
                        left: toX(freeFromSec) + 16,
                      }}
                    >
                      <EmptySlotButton
                        onClick={() => onOpenEmptySlot(barista.id)}
                        className="h-full min-w-[130px]"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {markers
            .filter((marker) => marker.isHour)
            .map((marker) => (
              <div
                key={`hour-line-${marker.sec}`}
                className="pointer-events-none absolute top-[30px] bottom-0 z-20 w-[2px] bg-slate-500/70"
                style={{ left: `${STICKY_LEFT_WIDTH + toX(marker.sec)}px` }}
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
      {drag.source &&
        drag.ghost(
          <OrderCard
            card={drag.source.ticket}
            className="border-l-[5px] border-l-slate-400"
          />,
          drag.target ? `→ ${drag.target}` : null,
        )}
    </div>
  );
};
