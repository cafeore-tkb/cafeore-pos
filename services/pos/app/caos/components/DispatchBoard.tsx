import { type CaosCard, canSplitCard, dripperLabel } from "@cafeore/common";
import { RotateCcw, Sparkles, X } from "lucide-react";
import type React from "react";
import {
  type DropTarget,
  dropSideOn,
  dropTargetAt,
  dropTargetLabel,
  useCardDrag,
} from "../hooks/useCardDrag";
import { useOutsidePress } from "../hooks/useOutsidePress";
import { useTimelineScroll } from "../hooks/useTimelineScroll";
import type { UnassignedPick } from "../hooks/useUnassignedPick";
import { cardName, orderLabel, sharesOrder } from "../logic/cards";
import { laneActive, laneCards, pendingNominatedCups } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
import { positionTickets, timeMarkers, timelineRange } from "../logic/timeline";
import { DripperIndicator, EmptySlotButton, NextButton } from "./BoardParts";
import type { ControlViewProps } from "./ControlWorkspace";
import { LaneChangeButton, LaneName } from "./LaneParts";
import {
  BayPad,
  CancelEmergencyButton,
  DropMark,
  MergeOverlay,
  OrderCard,
  SplitCupButtons,
} from "./OrderCard";
import { ScrollArea } from "./ScrollArea";

// 管制盤 A のタイムライン。6 列（1st〜6th）の抽出中・待機・終わったカードを、時刻の位置に並べる。
// 左端はドリッパーの番号（列の状態のインジケーター）と担当者、右端は「次へ」（右手で押しても、腕でタイムラインを隠さない）。
// 待機のカードはタップで 1〜6 のボタン（今の列は「先頭」「待機の先頭」も。もう一度タップで未割当に戻す）を開き、その注文を選ぶ（閉じたら外す）。
// 抽出中のカードはタップで緊急のパネル（1〜6 に移す・未割当に戻すも）。未割当のカードを開いているあいだは、統合できる待機・抽出中のカードに
// 「統合する」が出て、押すとそのカードに統合する（pick。下の横帯と共有。1〜6 のボタンは開かない）。
// 待機・抽出中のカードはなぞると掴んで移す（列に落とすとその列の最後。待機・抽出中のカードの上に落とすと、左の端はそのカードの前・
// 右の端は後ろ・真ん中は統合（統合できる相手のときだけ。useCardDrag の dropTargetAt）。抽出中のカードの前は列の先頭で今から始まり、
// 後ろは待機の先頭。同じ列の中の入れ替えにも使う。抽出中のカードを落として統合したら相手を抽出中のカードに入れる）。
// 指の下のカードには、入れる所の線か統合の枠を出す（DropMark）。
// 統合したカードを開くと「外す」（統合の解除）が出る。
// タイムラインの横スクロールは下のスクロールバー（ScrollArea。溝は時刻の部分の下だけ）か、カードの無い所をなぞる
// （左右の固定の列はなぞってもスクロールしない。「次へ」を急いで押して指が滑っても、NOW の追従が外れない）。
// 手でスクロールすると NOW の追従をやめ、左上の「現在に戻る」（ヘッダーの「現在」と同じ）で戻る。
// 左へスクロールして隠れたカードの商品・注文番号・杯数は、左の固定の列のすぐ右に寄せて残す（cardInset。カードの右の端まで来たらカードと一緒に流れる）。

const PIXELS_PER_SEC = 1.2; // 1 min = 72px
// 左端の列（ドリッパーの番号と担当者）の幅
const STICKY_LEFT_WIDTH = 168;
// 右端の列（次へ）の幅
const NEXT_COLUMN_WIDTH = 96;
// NOW の左に見せる過去（2 分半）。抽出中のカードの始めてから今までと、寄せて残した商品・注文番号が NOW の線の左に収まる幅
const NOW_VIEWPORT_OFFSET = 150 * PIXELS_PER_SEC;
// 左へ隠れたカードで、商品・注文番号・杯数を寄せて残す幅（px。これより狭くは寄せず、カードと一緒に流れる）
const MIN_LABEL_WIDTH = 120;

/**
 * カードの左の余白。左の固定の列の下に隠れた分（タイムラインのスクロールの位置 --timeline-left からカードの左の位置を引いた分）だけ
 * 中身を右に寄せる（隠れても商品・注文番号が左の固定の列のすぐ右に見える）。寄せるのは中身の幅が MIN_LABEL_WIDTH になるまで。
 * スクロールのたびに盤面を描き直さないよう、位置は CSS の変数（useTimelineScroll が書く）で受ける。0.5rem はカード（OrderCard の md）の左の余白
 */
const cardInset = (left: number, width: number) =>
  `calc(0.5rem + clamp(0px, var(--timeline-left, 0px) - ${left}px, ${Math.max(0, width - MIN_LABEL_WIDTH)}px))`;

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
  onOpenTicket,
  onOpenRebrew,
  onCancelEmergency,
  actionTicketKey,
  onMoveTicket,
  onReturnToUnassigned,
  onCloseTicket,
  onOpenEmptySlot,
  onOpenLane,
  onMergeOrders,
  onSplitCup,
  nowMs,
  timelineCommand,
  readOnly = false,
  pick,
  flashKeys,
  onFollowNowChange,
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
    // 探したカードは、左端の列のすぐ右に（右のパネルを開いていても隠れない）
    cardInsetPx: STICKY_LEFT_WIDTH + 24,
    command: timelineCommand,
    onFollowingChange: onFollowNowChange,
  });
  const markers = timeMarkers(range.startMs, range.endMs);

  // 待機・抽出中のカードを別の列へ・カードの前後へ・統合（今の列そのもの（カードの無い所）と、指名以外の列には置けない）
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
      onCloseTicket();
    },
  });

  // 1〜6 のボタンを開いたカードの外を押すと閉じる（注文の選択も外す）
  useOutsidePress(
    actionTicketKey !== null,
    (target) =>
      target.closest<HTMLElement>("[data-card-key]")?.dataset.cardKey ===
      actionTicketKey,
    onCloseTicket,
  );

  // ドラッグ（タイムラインのカードか、下の横帯の未割当のカード）で指の下の落とす先
  const dropTarget = drag.target ?? pick?.drag.target ?? null;

  // 選んだ注文のカード（列ごと）
  const matchingTickets = lanes.flatMap((lane) =>
    laneCards(lane)
      .filter((card) => sharesOrder(card, selectedOrderId))
      .map(
        (card) =>
          `ドリッパー ${dripperLabel(lane.id)}: ${cardName(card)} ${card.cups.length}杯`,
      ),
  );

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
        trackInset={{
          start: STICKY_LEFT_WIDTH,
          end: readOnly ? 0 : NEXT_COLUMN_WIDTH,
        }}
        scrollRef={scroll.containerRef}
        onScroll={scroll.onScroll}
        scrollerClassName="touch-auto select-none overscroll-x-contain"
      >
        <div className="relative w-max">
          {/* 時刻の目盛り */}
          <div className="relative flex h-[30px] items-center border-slate-200 border-b bg-slate-50 font-medium font-mono text-[11px] text-slate-500">
            <div
              style={{ width: STICKY_LEFT_WIDTH }}
              className="sticky left-0 isolate z-[60] flex h-full shrink-0 touch-none items-center border-slate-300 border-r bg-slate-50 px-3 font-bold font-sans text-[11px] text-slate-500 shadow-[4px_0_10px_rgba(15,23,42,0.08)]"
            >
              {scroll.isFollowingNow ? (
                "ドリッパー / 抽出担当"
              ) : (
                // 手でスクロールして NOW の追従をやめているあいだ（閲覧だけの画面にはヘッダーの「現在」が無いので、ここで戻す）
                <button
                  type="button"
                  onClick={scroll.toNow}
                  className="-mx-2 flex h-[26px] flex-1 items-center justify-center gap-1 rounded-md bg-red-500 font-black text-[12px] text-white shadow-sm active:bg-red-600"
                >
                  <span className="h-2 w-2 rounded-full bg-white" />
                  現在に戻る
                </button>
              )}
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
            {!readOnly && <NextColumn className="h-full bg-slate-50" />}
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
                  {/* ドリッパーの番号（列の状態）と担当者・交代 */}
                  <div
                    style={{ width: STICKY_LEFT_WIDTH }}
                    className="sticky left-0 isolate z-[51] flex shrink-0 touch-none items-center gap-2 self-stretch border-slate-300 border-r bg-white px-2 shadow-[4px_0_10px_rgba(15,23,42,0.08)]"
                  >
                    <DripperIndicator
                      bayId={bay.id}
                      status={lane}
                      nominatedCups={pendingNominatedCups(
                        unassignedOrders,
                        bay.id,
                      )}
                      onOpenLane={onOpenLane}
                      className="h-[66px] w-[44px]"
                    />
                    <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                      <LaneName
                        dripper={bay.id}
                        wrap
                        className="max-w-full font-black text-[16px] text-slate-950 leading-tight"
                      />
                      <LaneChangeButton dripper={bay.id} />
                    </div>
                  </div>

                  {/* カードを時刻の位置に（幅は抽出時間） */}
                  <div
                    className="relative h-[80px] [&>*]:absolute [&>*]:top-1.5 [&>*]:bottom-1.5"
                    style={{ width: `${timelineWidthPx}px` }}
                  >
                    {positioned.map(({ card: ticket, startMs, endMs }) => {
                      // Drips that ended before the track starts would otherwise pile up at its left edge.
                      if (endMs <= range.startMs) return null;
                      // 動かせるのは待機・抽出中のカード（閲覧だけの画面では動かさない）。1〜6 のボタンを開くのは待機のカード
                      const isMovable = !readOnly && ticket.status !== "done";
                      const isScheduled =
                        isMovable && ticket.status === "queued";
                      const isActionOpen =
                        isScheduled && actionTicketKey === ticket.key;
                      // 開いた未割当のカードを、押して統合できる待機・抽出中のカード
                      const isMergeTap =
                        isMovable && Boolean(pick?.canMergeWith(ticket));
                      const left = Math.max(10, toX(startMs));
                      const width = Math.max(
                        130,
                        ((endMs - startMs) / 1000) * PIXELS_PER_SEC,
                      );
                      return (
                        <div
                          key={ticket.key}
                          className={`${isActionOpen ? "z-[80]" : ""} ${flashKeys?.has(ticket.key) ? "caos-arrival rounded-lg" : ""}`}
                          style={{ left, width }}
                        >
                          <OrderCard
                            card={ticket}
                            look={looks.get(ticket.key)}
                            selected={sharesOrder(ticket, selectedOrderId)}
                            data-card-key={ticket.key}
                            data-search-key={ticket.key}
                            // 待機・抽出中のカードは、ドラッグで落とすと前・後ろ・統合の目印になる（useCardDrag の dropTargetAt）
                            data-queued-ticket={
                              isMovable ? ticket.key : undefined
                            }
                            data-ticket-label={orderLabel(ticket)}
                            data-merge-tap={isMergeTap || undefined}
                            style={{ paddingLeft: cardInset(left, width) }}
                            onPointerDown={
                              isMovable
                                ? (event) =>
                                    drag.press(
                                      { card: ticket, bayId: bay.id },
                                      event,
                                    )
                                : undefined
                            }
                            onClickCapture={drag.suppressClick}
                            onClick={() => {
                              if (isMergeTap) {
                                pick?.tap(ticket);
                                return;
                              }
                              // 抽出中・終わりのカードは入れ直し（閲覧だけの画面では渡されない）
                              if (!isScheduled) {
                                onOpenRebrew?.(ticket);
                                return;
                              }
                              if (!isActionOpen) onOpenTicket(ticket);
                              else {
                                onReturnToUnassigned(ticket);
                                onCloseTicket();
                              }
                            }}
                            // 影は統合したカードの重ねた枠に使うので、指を乗せた印は輪にする
                            className={`h-full hover:ring-2 hover:ring-slate-400 ${isMovable ? "cursor-grab touch-none active:cursor-grabbing" : "touch-manipulation"}`}
                            dragging={drag.source?.card.key === ticket.key}
                          >
                            {isMergeTap && <MergeOverlay />}
                            <DropMark
                              side={dropSideOn(dropTarget, ticket.key)}
                            />
                            {isActionOpen && (
                              <>
                                <BayPad
                                  card={ticket}
                                  currentBayId={bay.id}
                                  hoveredBay={drag.target?.bayId ?? null}
                                  onPick={(bayId, place) => {
                                    onMoveTicket(ticket, bayId, place);
                                    onCloseTicket();
                                  }}
                                />
                                <div className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center rounded-md bg-red-500/10">
                                  <X className="h-10 w-10 stroke-[3] text-red-600/35" />
                                </div>
                                {canSplitCard(ticket) && (
                                  <SplitCupButtons
                                    card={ticket}
                                    onSplit={(cupId) => {
                                      onSplitCup(ticket, cupId);
                                      onCloseTicket();
                                    }}
                                  />
                                )}
                                {ticket.emergency && onCancelEmergency && (
                                  <CancelEmergencyButton
                                    onConfirm={() => {
                                      onCancelEmergency(ticket);
                                      onCloseTicket();
                                    }}
                                  />
                                )}
                              </>
                            )}
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

                  {/* 次へ（右端に固定） */}
                  {!readOnly && (
                    <NextColumn className="self-stretch bg-white">
                      <NextButton
                        bayId={bay.id}
                        active={Boolean(lane.current)}
                        locked={lane.nextLocked}
                        onAdvance={onAdvanceBay}
                        className="h-[64px] w-full text-[17px]"
                      />
                    </NextColumn>
                  )}
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

/** 右端に固定する「次へ」の列（目盛りの行は空） */
const NextColumn: React.FC<{
  className: string;
  children?: React.ReactNode;
}> = ({ className, children }) => (
  <div
    style={{ width: NEXT_COLUMN_WIDTH }}
    className={`sticky right-0 isolate z-50 flex shrink-0 touch-none items-center justify-center border-slate-300 border-l px-2 shadow-[-4px_0_10px_rgba(15,23,42,0.08)] ${className}`}
  >
    {children}
  </div>
);
