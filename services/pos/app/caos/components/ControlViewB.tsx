import { formatMinSec } from "@cafeore/common";
import {
  CheckCircle2,
  ChevronRight,
  CircleDot,
  ClipboardList,
  Link2,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import type { Barista, OrderTicket, UnassignedOrder } from "../types";
import { cardHasBean } from "../utils/beans";
import { laneOrdinal } from "../utils/lanes";
import { activeRemainingSec, queueWaitSeconds } from "../utils/orderQueue";

export interface ControlViewBProps {
  baristas: Barista[];
  unassignedOrders: UnassignedOrder[];
  simTimeSec: number;
  selectedOrderId: string | null;
  // 豆で絞り込む（盤面のカードは在庫対象の ID、実データテストのカードは豆のコード）
  highlightFilter: string | null;
  onSelectOrder: (orderId: string) => void;
  onSelectQueueOrder: (order: UnassignedOrder) => void;
  onAdvanceBay: (bayId: number) => void;
  onOpenTicketDetail: (ticket: OrderTicket) => void;
  onOpenEmptySlot: (bayId: number) => void;
  onAssignToBay: (order: UnassignedOrder, bayId: number) => void;
}

interface OrderGroup {
  id: string;
  items: UnassignedOrder[];
}

export const ControlViewB: React.FC<ControlViewBProps> = ({
  baristas,
  unassignedOrders,
  simTimeSec,
  selectedOrderId,
  highlightFilter,
  onSelectOrder,
  onSelectQueueOrder,
  onAdvanceBay,
  onOpenTicketDetail,
  onOpenEmptySlot,
  onAssignToBay,
}) => {
  const [openPadUid, setOpenPadUid] = useState<string | null>(null);
  const orderUid = (order: UnassignedOrder) => order.ticketUid || order.id;

  useEffect(() => {
    if (!openPadUid) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest(`[data-b-order-uid="${openPadUid}"]`)) return;
      setOpenPadUid(null);
      onSelectOrder("");
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [openPadUid, onSelectOrder]);

  const openAssignmentPad = (order: UnassignedOrder) => {
    if (selectedOrderId !== order.id) onSelectQueueOrder(order);
    setOpenPadUid(orderUid(order));
  };

  const assignToBay = (order: UnassignedOrder, bayId: number) => {
    if (order.preferredBaristaId && order.preferredBaristaId !== bayId) return;
    onAssignToBay(order, bayId);
    setOpenPadUid(null);
  };
  const sortedBaristas = useMemo(
    () => [...baristas].sort((a, b) => a.bayNumber - b.bayNumber),
    [baristas],
  );

  const orderGroups = useMemo<OrderGroup[]>(() => {
    const groups = new Map<string, UnassignedOrder[]>();
    unassignedOrders.forEach((order) => {
      const items = groups.get(order.id) || [];
      items.push(order);
      groups.set(order.id, items);
    });
    return Array.from(groups, ([id, items]) => ({ id, items }));
  }, [unassignedOrders]);

  const nextAvailable = useMemo(
    () =>
      sortedBaristas
        .map((barista) => ({
          bayNumber: barista.bayNumber,
          seconds: queueWaitSeconds(barista.queue),
          isStandby: barista.queue.length === 0,
        }))
        .sort((a, b) => a.seconds - b.seconds || a.bayNumber - b.bayNumber)
        .slice(0, 3),
    [sortedBaristas],
  );

  const selectedRoutes = useMemo(() => {
    if (!selectedOrderId) return [];
    return sortedBaristas.flatMap((barista) =>
      barista.queue
        .filter((ticket) => ticket.id === selectedOrderId)
        .map((ticket) => ({
          uid:
            ticket.ticketUid || `${ticket.id}-${barista.id}-${ticket.beanCode}`,
          beanName: ticket.beanName,
          bayNumber: barista.bayNumber,
        })),
    );
  }, [selectedOrderId, sortedBaristas]);

  const visibleGroups = orderGroups.slice(0, 10);
  const totalUnassignedCups = unassignedOrders.reduce(
    (sum, order) => sum + order.cupCount,
    0,
  );

  return (
    <section
      className="flex h-full min-h-0 flex-col gap-2 overflow-hidden"
      aria-label="Bコントロール画面"
    >
      <div className="shrink-0 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
        <div className="flex h-[40px] items-center justify-between gap-3 border-slate-200 border-b bg-slate-50 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <CircleDot className="h-4 w-4 shrink-0 text-emerald-600" />
            <div className="min-w-0">
              <h2 className="font-black text-[15px] text-slate-900 tracking-wide">
                6人のドリッパー
              </h2>
            </div>
          </div>
        </div>

        {selectedOrderId && (
          <div className="flex h-[42px] items-center gap-2 border-amber-200 border-b bg-amber-50 px-3 text-[12px] text-amber-950">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-amber-600" />
            <span className="font-black font-mono text-[20px]">
              {selectedOrderId}
            </span>
            <span className="shrink-0 font-bold">連動:</span>
            <span className="truncate font-medium">
              {selectedRoutes.length > 0
                ? selectedRoutes
                    .map(
                      (route) =>
                        `${route.beanName} → ドリッパー ${route.bayNumber}`,
                    )
                    .join(" / ")
                : "まだドリッパーに割り当てられていません"}
            </span>
            <button
              type="button"
              onClick={() => onSelectOrder("")}
              className="ml-auto min-h-[36px] min-w-[56px] shrink-0 touch-manipulation rounded-lg border border-amber-300 bg-white px-2 font-bold hover:bg-amber-100"
            >
              解除
            </button>
          </div>
        )}

        <div className="grid grid-cols-6 divide-x divide-slate-200">
          {sortedBaristas.map((barista) => {
            const current = barista.queue[0];
            const next = barista.queue[1];
            const remainingSeconds = activeRemainingSec(barista, simTimeSec);
            const isImminent = current && remainingSeconds <= 30;
            const isLinked = Boolean(
              selectedOrderId &&
                barista.queue.some((ticket) => ticket.id === selectedOrderId),
            );

            return (
              <article
                key={barista.id}
                className={`flex min-w-0 flex-col gap-1.5 p-2 transition-colors ${
                  isLinked
                    ? "bg-amber-50 ring-2 ring-amber-400 ring-inset"
                    : "bg-white"
                }`}
              >
                <div className="flex min-h-[32px] items-start justify-between gap-1">
                  <div>
                    <div className="font-black font-mono text-[11px] text-slate-500 uppercase">
                      ドリッパー
                    </div>
                    <div className="font-black font-mono text-[15px] text-slate-950 leading-tight">
                      {laneOrdinal(barista.bayNumber)}
                    </div>
                  </div>
                </div>

                <div
                  className={`min-h-[104px] w-full rounded-md border p-2 text-left transition-colors ${
                    current
                      ? isImminent
                        ? "border-red-300 bg-red-50"
                        : "border-slate-950 bg-slate-950 text-white"
                      : "border-slate-300 border-dashed bg-slate-50 text-slate-400"
                  }`}
                >
                  <div
                    className={`font-black text-[9px] tracking-[0.16em] ${isImminent ? "text-red-600" : "text-slate-400"}`}
                  >
                    NOW
                  </div>
                  {current ? (
                    <>
                      <div
                        className={`mt-1 flex items-start justify-between gap-1 ${isImminent ? "text-slate-950" : "text-white"}`}
                      >
                        <div className="min-w-0">
                          <div className="truncate font-black text-[15px] leading-tight">
                            {current.beanName}
                          </div>
                          <div className="mt-0.5 flex items-center gap-1 font-bold text-[10px] opacity-85">
                            <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[14px] text-slate-950 leading-none opacity-100">
                              {current.cupCount}杯
                            </span>
                            {current.totalItemsInOrder &&
                              current.totalItemsInOrder > 1 && (
                                <span>
                                  {current.itemIndex}/
                                  {current.totalItemsInOrder}・計
                                  {current.totalOrderCups}杯
                                </span>
                              )}
                          </div>
                        </div>
                        <span className="shrink-0 font-black font-mono text-[21px] leading-none">
                          {current.id}
                        </span>
                      </div>
                      <div
                        className={`mt-1.5 font-black font-mono text-[30px] leading-none tracking-tight ${isImminent ? "text-red-600" : "text-white"}`}
                      >
                        {remainingSeconds === 0
                          ? "継続中"
                          : formatMinSec(remainingSeconds)}
                      </div>
                    </>
                  ) : (
                    <div className="flex h-[62px] items-center justify-center font-bold text-[14px]">
                      待機中
                    </div>
                  )}
                </div>

                <div className="min-h-[58px] rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5">
                  <div className="font-black text-[9px] text-slate-500 tracking-[0.16em]">
                    NEXT
                  </div>
                  {next ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedOrderId !== next.id) onSelectOrder(next.id);
                        onOpenTicketDetail(next);
                      }}
                      className="mt-1 flex w-full touch-manipulation items-center justify-between gap-1 text-left hover:text-blue-700"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="truncate font-black text-[12px]">
                            {next.beanName}
                          </span>
                          <span className="rounded bg-slate-950 px-1.5 py-0.5 font-black font-mono text-[14px] text-white leading-none">
                            {next.cupCount}杯
                          </span>
                          {next.totalItemsInOrder &&
                            next.totalItemsInOrder > 1 && (
                              <span className="font-black font-mono text-[10px]">
                                {next.itemIndex}/{next.totalItemsInOrder}・計
                                {next.totalOrderCups}杯
                              </span>
                            )}
                        </div>
                        <div className="font-black font-mono text-[15px] text-slate-700">
                          {next.id}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onOpenEmptySlot(barista.id)}
                      className="mt-1 min-h-[36px] w-full touch-manipulation rounded border border-slate-300 border-dashed font-bold text-[10px] text-slate-500 hover:border-blue-400 hover:bg-blue-50"
                    >
                      + 次を割当
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  disabled={!current}
                  onClick={() => onAdvanceBay(barista.id)}
                  className="flex min-h-[42px] touch-manipulation items-center justify-center gap-1.5 rounded-lg bg-emerald-700 font-black text-[13px] text-white transition-colors hover:bg-emerald-800 disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <span>次へ</span>
                  <CheckCircle2 className="h-4 w-4" />
                </button>
              </article>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-300 bg-white p-2 shadow-xs">
        <div className="mb-1 flex h-[34px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <ClipboardList className="h-4 w-4 shrink-0 text-blue-700" />
            <h2 className="font-black text-[16px] text-slate-950 tracking-wide">
              注文キュー
            </h2>
            <span className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-bold text-[12px] text-slate-600">
              {orderGroups.length} 件 / {totalUnassignedCups} 杯
            </span>
            <div className="flex items-center gap-1.5 overflow-x-auto">
              <span className="ml-1 shrink-0 font-bold text-[11px] text-slate-500">
                次に空く:
              </span>
              {nextAvailable.map((item, index) => (
                <span
                  key={item.bayNumber}
                  className={`whitespace-nowrap rounded border px-2 py-0.5 font-black font-mono text-[11px] ${
                    index === 0
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "border-slate-200 bg-white text-slate-700"
                  }`}
                >
                  #{item.bayNumber}{" "}
                  {item.isStandby ? "待機" : formatMinSec(item.seconds)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {visibleGroups.length > 0 ? (
          <div className="grid h-[calc(100%-38px)] grid-cols-5 grid-rows-2 gap-1.5">
            {visibleGroups.map((group, index) => {
              const isSelected = selectedOrderId === group.id;
              const matchesHeaderFilter = Boolean(
                highlightFilter &&
                  group.items.some((item) =>
                    cardHasBean(item, highlightFilter),
                  ),
              );
              const assignedRoutes = sortedBaristas.flatMap((barista) =>
                barista.queue
                  .filter((ticket) => ticket.id === group.id)
                  .map(
                    (ticket) =>
                      `${ticket.beanName} → ドリッパー${barista.bayNumber}`,
                  ),
              );

              return (
                <article
                  key={group.id}
                  data-b-order-uid={orderUid(
                    group.items.find((item) => orderUid(item) === openPadUid) ||
                      group.items[0],
                  )}
                  onClick={() => {
                    openAssignmentPad(group.items[0]);
                  }}
                  className={`relative min-h-0 cursor-pointer touch-manipulation rounded-lg border p-2 transition-all active:scale-[0.99] ${openPadUid && group.items.some((item) => orderUid(item) === openPadUid) ? "z-40 overflow-visible" : "overflow-hidden"} ${
                    isSelected
                      ? "border-blue-500 bg-blue-50 shadow-sm ring-2 ring-blue-400"
                      : matchesHeaderFilter
                        ? "border-sky-400 bg-sky-50"
                        : "border-slate-300 bg-white hover:border-slate-500 hover:shadow-sm"
                  }`}
                >
                  {(() => {
                    const openOrder = group.items.find(
                      (item) => orderUid(item) === openPadUid,
                    );
                    if (!openOrder) return null;
                    return (
                      <>
                        <div
                          className="-top-[38px] absolute right-0 left-0 z-50 grid h-[34px] grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 shadow-xl"
                          aria-label={`${openOrder.id}の割当先 1から3`}
                        >
                          {[1, 2, 3].map((bayId) => (
                            <button
                              key={bayId}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                assignToBay(openOrder, bayId);
                              }}
                              disabled={Boolean(
                                openOrder.preferredBaristaId &&
                                  openOrder.preferredBaristaId !== bayId,
                              )}
                              className={`touch-manipulation rounded-md border font-black font-mono text-[17px] disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-500 ${openOrder.preferredBaristaId === bayId ? "border-violet-300 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-950"}`}
                            >
                              {bayId}
                            </button>
                          ))}
                        </div>
                        <div
                          className="-bottom-[38px] absolute right-0 left-0 z-50 grid h-[34px] grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 shadow-xl"
                          aria-label={`${openOrder.id}の割当先 4から6`}
                        >
                          {[4, 5, 6].map((bayId) => (
                            <button
                              key={bayId}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                assignToBay(openOrder, bayId);
                              }}
                              disabled={Boolean(
                                openOrder.preferredBaristaId &&
                                  openOrder.preferredBaristaId !== bayId,
                              )}
                              className={`touch-manipulation rounded-md border font-black font-mono text-[17px] disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-500 ${openOrder.preferredBaristaId === bayId ? "border-violet-300 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-950"}`}
                            >
                              {bayId}
                            </button>
                          ))}
                        </div>
                      </>
                    );
                  })()}
                  <div className="flex items-start justify-between gap-2 border-slate-200 border-b pb-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`flex h-7 w-7 items-center justify-center rounded-md font-black font-mono text-[14px] ${
                          isSelected
                            ? "bg-blue-700 text-white"
                            : "bg-slate-900 text-white"
                        }`}
                      >
                        {index + 1}
                      </span>
                      <div>
                        <div
                          className={`font-black font-mono text-[24px] leading-none ${isSelected ? "text-blue-800" : group.items[0].preferredBaristaId ? "text-violet-700" : group.items.some((item) => item.totalItemsInOrder && item.totalItemsInOrder > 1) ? "text-slate-950" : "text-slate-600"}`}
                        >
                          {group.id}
                        </div>
                        {group.items[0].preferredBaristaId && (
                          <div className="mt-1 inline-flex rounded bg-violet-700 px-1.5 py-0.5 font-black text-[11px] text-white">
                            指名 {group.items[0].preferredBaristaId}
                          </div>
                        )}
                        {group.items[0].totalOrderCups && (
                          <div className="mt-0.5 font-bold text-[11px] text-slate-500">
                            計 {group.items[0].totalOrderCups}杯
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="mt-1.5 space-y-1">
                    {group.items.map((item) => (
                      <button
                        type="button"
                        key={item.ticketUid || `${item.id}-${item.beanCode}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          openAssignmentPad(item);
                        }}
                        className="w-full touch-manipulation rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-left transition-colors hover:border-blue-300 hover:bg-blue-50"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="truncate font-black text-[13px] text-slate-900">
                            {item.beanName}
                          </span>
                          <span className="shrink-0 rounded bg-slate-950 px-1.5 py-0.5 font-black font-mono text-[14px] text-white leading-none">
                            {item.cupCount}杯
                          </span>
                          {item.totalItemsInOrder &&
                            item.totalItemsInOrder > 1 && (
                              <span className="shrink-0 font-black font-mono text-[10px] text-slate-600">
                                {item.itemIndex}/{item.totalItemsInOrder}・計
                                {item.totalOrderCups}杯
                              </span>
                            )}
                        </div>
                        {item.preferredBaristaId && (
                          <div className="mt-1 font-black text-[10px] text-violet-700">
                            指名 {item.preferredBaristaId}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>

                  {assignedRoutes.length > 0 && (
                    <div className="mt-2 truncate border-blue-200 border-t pt-1.5 font-bold text-[9px] text-blue-800">
                      {assignedRoutes.join(" / ")}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="flex min-h-[150px] items-center justify-center rounded-lg border border-slate-300 border-dashed bg-slate-50 font-bold text-[12px] text-slate-500">
            未割当オーダーはありません
          </div>
        )}

        {orderGroups.length > visibleGroups.length && (
          <div className="mt-2 text-right font-bold text-[10px] text-slate-500">
            他 {orderGroups.length - visibleGroups.length} 件はキュー後方
          </div>
        )}
      </div>
    </section>
  );
};
