import { type CaosCard, dripperLabel } from "@cafeore/common";
import { RotateCcw, Sparkles, X } from "lucide-react";
import type React from "react";
import {
  type DropTarget,
  dropTargetAt,
  dropTargetLabel,
  useCardDrag,
  useCardHold,
} from "../hooks/useCardDrag";
import { useTimelineScroll } from "../hooks/useTimelineScroll";
import type { UnassignedPick } from "../hooks/useUnassignedPick";
import {
  cardName,
  orderLabel,
  selectedComments,
  sharesOrder,
} from "../logic/cards";
import { laneActive, laneCards, pendingNominatedCups } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
import { positionTickets, timeMarkers, timelineRange } from "../logic/timeline";
import { DripperIndicator, EmptySlotButton, NextButton } from "./BoardParts";
import type { ControlViewProps } from "./ControlWorkspace";
import { LaneChangeButton, LaneName } from "./LaneParts";
import { MergeOverlay, OrderCard } from "./OrderCard";
import { CommentLine } from "./OrderComments";
import { ScrollArea } from "./ScrollArea";

// 管制盤 A のタイムライン。6 列（1st〜6th）の抽出中・待機・終わったカードを、時刻の位置に並べる。
// 左端はドリッパーの番号（列の状態のインジケーター）と担当者、その右に「次へ」。
// カードはボタンを付けず、押すと抽出中は終える・待機はそれを始める（onPressCard）。長押しで待機は詳細、抽出中・終わりは緊急のパネル（onHoldCard）。
// 未割当のカードを開いているあいだは、統合できる抽出中のカードに「統合する」が出て、押すとそのカードに統合する（pick。下の横帯と共有）。
// 待機・抽出中のカードはなぞると掴んで移す（列に落とすとその列の最後、待機・抽出中のカードの上に落とすとそのカードの前。
// 抽出中のカードの前は列の先頭で、今から始まる。同じ列の中の入れ替えにも使う。
// 統合できる待機のカードの上の右の部分・統合できる抽出中のカードの上に落とすと統合。抽出中のカードを落としたら相手を抽出中のカードに入れる）。
// タイムラインの横スクロールは下のスクロールバー（ScrollArea。溝は時刻の部分の下だけ）か、カードの無い所をなぞる。

const PIXELS_PER_SEC = 1.2; // 1 min = 72px
// 左端の列（ドリッパーの番号・担当者と「次へ」）の幅
const STICKY_LEFT_WIDTH = 240;
// 90 seconds of past context remains visible to the left of NOW.
const NOW_VIEWPORT_OFFSET = 90 * PIXELS_PER_SEC;

const tickClass = (marker: { isHour: boolean; isMajor: boolean }) => {
  if (marker.isHour) return "h-[12px] w-[2px] bg-slate-700";
  if (marker.isMajor) return "h-[10px] w-[1px] bg-slate-400";
  return "h-[7px] w-[1px] bg-slate-300";
};

export const DispatchBoard: React.FC<
  Omit<ControlViewProps, "nextAvailable" | "onAssignToBay"> & {
    /** 未割当のカードの操作（下の横帯と共有。開いた未割当のカードを、押した抽出中のカードに統合する） */
    pick?: UnassignedPick;
  }
> = ({
  lanes,
  unassignedOrders,
  looks,
  selectedOrderId,
  onSelectOrder,
  onAdvanceBay,
  onPressCard,
  onHoldCard,
  onMoveTicket,
  onOpenEmptySlot,
  onOpenLane,
  onMergeOrders,
  nowMs,
  timelineCommand,
  readOnly = false,
  pick,
  flashKeys,
}) => {
  const range = timelineRange(nowMs);
  // 時刻（エポックのミリ秒）の横の位置。表示する範囲の始まりからの差で決める
  const toX = (ms: number) => ((ms - range.startMs) / 1000) * PIXELS_PER_SEC;
  const timelineWidthPx = toX(range.endMs);
  // Position of current NOW cursor along timeline
  const nowX = toX(nowMs);
  const scroll = useTimelineScroll({
    nowX,
    followLeftPx: Math.max(0, nowX - NOW_VIEWPORT_OFFSET),
    originPx: (range.startMs / 1000) * PIXELS_PER_SEC,
    pagePx: 300 * PIXELS_PER_SEC,
    // 探したカードは、左端の列のすぐ右に（右のパネルを開いていても隠れない）
    cardInsetPx: STICKY_LEFT_WIDTH + 24,
    command: timelineCommand,
  });
  const markers = timeMarkers(range.startMs, range.endMs);

  // 待機・抽出中のカードを別の列へ・カードの前へ・統合（今の列そのものと、指名以外の列には置けない）
  const drag = useCardDrag<{ card: CaosCard; bayId: number }, DropTarget>({
    targetAt: ({ card, bayId }, x, y) =>
      dropTargetAt(x, y, {
        from: bayId,
        card,
        cards: lanes.flatMap(laneActive),
      }),
    onDrop: ({ card }, target) => {
      if (target.mergeKey) onMergeOrders(card.key, target.mergeKey);
      else onMoveTicket(card, target.bayId, target.place);
    },
    onHold: ({ card }) => {
      onHoldCard?.(card);
      return Boolean(onHoldCard);
    },
  });
  // 終わったカードは動かさないので、長押しだけ
  const hold = useCardHold<CaosCard>((card) => onHoldCard?.(card));

  // 選んだ注文のカード（列ごと）
  const matchingTickets = lanes.flatMap((lane) =>
    laneCards(lane)
      .filter((card) => sharesOrder(card, selectedOrderId))
      .map(
        (card) =>
          `ドリッパー ${dripperLabel(lane.id)}: ${cardName(card)} ${card.cups.length}杯`,
      ),
  );
  // 選んだ注文のコメント（未割当のカードも見る）
  const comments = selectedOrderId
    ? selectedComments(
        [...lanes.flatMap(laneCards), ...unassignedOrders],
        looks,
        selectedOrderId,
      )
    : [];

  return (
    <div className="relative flex shrink-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
      {scroll.isPastView && (
        <div
          style={{ left: STICKY_LEFT_WIDTH }}
          className="absolute top-0 z-[65] flex h-[30px] items-center gap-1 rounded-br-lg border-amber-200 border-r border-b bg-amber-50 px-3 font-bold text-[11px] text-amber-900"
        >
          <RotateCcw className="h-3 w-3" />
          <span>過去の抽出履歴を表示中</span>
        </div>
      )}

      {/* 選んだ注文（同じ注文のカードがどの列にあるか）。目盛りの上に重ね、下の列をずらさない */}
      {selectedOrderId && (
        <div className="absolute inset-x-0 top-0 z-[70] flex h-[30px] select-none items-center justify-between bg-amber-500 px-3 font-bold text-white text-xs shadow-xs">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
            <span className="flex items-center gap-1 rounded bg-amber-600 px-2 font-black font-mono text-[17px]">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{selectedOrderId}</span>
            </span>
            <span>連動:</span>
            <span className="rounded bg-amber-600/90 px-2 py-0.5 font-normal text-amber-100">
              {matchingTickets.join(" ＋ ") || "オーダー詳細表示"}
            </span>
            <CommentLine comments={comments} />
          </div>

          <button
            type="button"
            onClick={() => onSelectOrder(null)}
            className="flex h-[26px] min-w-[52px] cursor-pointer touch-manipulation items-center justify-center gap-1 rounded-lg bg-amber-700 px-2 font-bold text-[11px] transition-colors hover:bg-amber-800"
          >
            <X className="h-3.5 w-3.5" />
            <span>解除</span>
          </button>
        </div>
      )}

      <ScrollArea
        axis="x"
        trackInset={{ start: STICKY_LEFT_WIDTH, end: 0 }}
        scrollRef={scroll.containerRef}
        onScroll={scroll.onScroll}
        scrollerClassName="touch-auto select-none overscroll-x-contain"
      >
        <div className="relative w-max">
          {/* 時刻の目盛り */}
          <div className="relative flex h-[30px] items-center border-slate-200 border-b bg-slate-50 font-medium font-mono text-[11px] text-slate-500">
            <div
              style={{ width: STICKY_LEFT_WIDTH }}
              className="sticky left-0 isolate z-[60] flex h-full shrink-0 items-center border-slate-300 border-r bg-slate-50 px-3 font-bold font-sans text-[11px] text-slate-500 shadow-[4px_0_10px_rgba(15,23,42,0.08)]"
            >
              ドリッパー / 抽出担当
            </div>
            <div
              className="relative h-full"
              style={{ width: `${timelineWidthPx}px` }}
            >
              {markers.map((marker) => (
                <div
                  key={marker.ms}
                  className="absolute top-0 bottom-0 flex flex-col justify-between"
                  style={{ left: `${toX(marker.ms)}px` }}
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
            {lanes.map((bay) => {
              const lane = laneStatus(bay, nowMs);
              const { positioned, freeFromMs } = positionTickets(bay, nowMs);

              return (
                <div
                  key={bay.id}
                  data-bay-target={bay.id}
                  className="relative flex h-[80px] touch-manipulation items-center bg-white"
                >
                  {/* ドリッパーの番号（列の状態）と担当者・交代、その右に「次へ」 */}
                  <div
                    style={{ width: STICKY_LEFT_WIDTH }}
                    className="sticky left-0 isolate z-[51] flex shrink-0 items-center gap-2 self-stretch border-slate-300 border-r bg-white px-2 shadow-[4px_0_10px_rgba(15,23,42,0.08)]"
                  >
                    <DripperIndicator
                      bayId={bay.id}
                      status={lane}
                      nominatedCups={pendingNominatedCups(
                        unassignedOrders,
                        bay.id,
                      )}
                      onOpenLane={onOpenLane}
                      className="h-[66px] w-[80px]"
                    />
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                      <LaneName
                        dripper={bay.id}
                        className="max-w-full font-black text-[14px] text-slate-950"
                      />
                      <LaneChangeButton dripper={bay.id} />
                    </div>
                    {!readOnly && (
                      <NextButton
                        bayId={bay.id}
                        active={Boolean(lane.current)}
                        locked={lane.nextLocked}
                        onAdvance={onAdvanceBay}
                        className="h-[64px] w-[64px] shrink-0 text-[16px]"
                      />
                    )}
                  </div>

                  {/* カードを時刻の位置に（幅は抽出時間） */}
                  <div
                    className="relative h-[80px] [&>*]:absolute [&>*]:top-1.5 [&>*]:bottom-1.5"
                    style={{ width: `${timelineWidthPx}px` }}
                  >
                    {positioned.map(({ card: ticket, startMs, endMs }) => {
                      // Drips that ended before the track starts would otherwise pile up at its left edge.
                      if (endMs <= range.startMs) return null;
                      // 動かせるのは待機・抽出中のカード（閲覧だけの画面では押しても動かさない）
                      const isMovable = !readOnly && ticket.status !== "done";
                      // 開いた未割当のカードを、押して統合できる抽出中のカード
                      const isMergeTap =
                        isMovable && Boolean(pick?.canMergeWith(ticket));
                      return (
                        <div
                          key={ticket.key}
                          className={
                            flashKeys?.has(ticket.key)
                              ? "caos-arrival rounded-lg"
                              : ""
                          }
                          style={{
                            left: Math.max(10, toX(startMs)),
                            width: Math.max(
                              130,
                              ((endMs - startMs) / 1000) * PIXELS_PER_SEC,
                            ),
                          }}
                        >
                          <OrderCard
                            card={ticket}
                            look={looks.get(ticket.key)}
                            selected={sharesOrder(ticket, selectedOrderId)}
                            data-search-key={ticket.key}
                            // 待機・抽出中のカードは、ドラッグで落とすと「このカードの前へ」の目印になる（useCardDrag の dropTargetAt）
                            data-queued-ticket={
                              isMovable ? ticket.key : undefined
                            }
                            // 待機・抽出中のカードは、ドラッグで落とすと統合の相手になる
                            data-merge-target={
                              isMovable ? ticket.key : undefined
                            }
                            data-ticket-label={orderLabel(ticket)}
                            data-merge-tap={isMergeTap || undefined}
                            onPointerDown={(event) => {
                              if (readOnly) return;
                              if (isMovable)
                                drag.press(
                                  { card: ticket, bayId: bay.id },
                                  event,
                                );
                              else hold.press(ticket, event);
                            }}
                            onClickCapture={
                              isMovable
                                ? drag.suppressClick
                                : hold.suppressClick
                            }
                            onClick={() => {
                              if (readOnly) return;
                              if (isMergeTap) pick?.tap(ticket);
                              else onPressCard(ticket);
                            }}
                            // 影は統合したカードの重ねた枠に使うので、指を乗せた印は輪にする
                            className={`h-full hover:ring-2 hover:ring-slate-400 ${isMovable ? "cursor-grab touch-none active:cursor-grabbing" : "touch-manipulation"}`}
                            dragging={drag.source?.card.key === ticket.key}
                          >
                            {isMergeTap && <MergeOverlay />}
                          </OrderCard>
                        </div>
                      );
                    })}

                    {/* 空きスロット（最後のカードの後ろ。NOW より前には置かない） */}
                    {!readOnly && (
                      <div
                        style={{
                          left: toX(freeFromMs) + 16,
                        }}
                      >
                        <EmptySlotButton
                          onClick={() => onOpenEmptySlot(bay.id)}
                          className="h-full min-w-[130px]"
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {markers
            .filter((marker) => marker.isHour)
            .map((marker) => (
              <div
                key={`hour-line-${marker.ms}`}
                className="pointer-events-none absolute top-[30px] bottom-0 z-20 w-[2px] bg-slate-500/70"
                style={{ left: `${STICKY_LEFT_WIDTH + toX(marker.ms)}px` }}
                aria-hidden="true"
              />
            ))}
          {/* Drawn on the track so it marks the real time even while browsing away from NOW. */}
          <div
            className="pointer-events-none absolute top-0 bottom-0 z-40 w-[2px] bg-red-500"
            style={{ left: `${STICKY_LEFT_WIDTH + nowX}px` }}
            aria-hidden="true"
          >
            <div className="-translate-x-1/2 absolute top-1 rounded-md bg-red-500 px-2 py-0.5 font-black text-[10px] text-white shadow-sm">
              NOW
            </div>
          </div>
        </div>
      </ScrollArea>
      {drag.source &&
        drag.ghost(
          <OrderCard
            card={drag.source.card}
            look={looks.get(drag.source.card.key)}
          />,
          dropTargetLabel(drag.target),
        )}
    </div>
  );
};
