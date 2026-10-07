import { formatMinSec } from "@cafeore/common";
import { ClipboardList, Sparkles } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UnassignedOrder } from "../types";
import { canPlaceOn } from "../utils/lanes";
import { cardSurface } from "../utils/menuPresentation";
import { canMergeDripUnits } from "../utils/orderQueue";
import { BeanBadge } from "./BeanBadge";

const MergeCupsIcon = ({ className = "" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 25.04 19.03" aria-hidden="true">
    <path
      fill="currentColor"
      d="M3.04,12.26c-.63-.55-1.04-1.35-1.04-2.26V2h12v1h0,0v.03h2v-1.03c0-1.1-.9-2-2-2H2C.9,0,0,.9,0,2v8c0,2.07,1.27,3.86,3.07,4.61-.02-.19-.03-.39-.03-.58v-1.77Z"
    />
    <path
      fill="currentColor"
      d="M20.04,4.03H6.04c-1.1,0-2,.9-2,2v8c0,.3.04.6.09.88.07.37.16.72.3,1.06.76,1.79,2.54,3.06,4.61,3.06h6c2.76,0,5-2.24,5-5,2.76,0,5-2.24,5-5s-2.24-5-5-5ZM18.04,14.03c0,1.65-1.35,3-3,3h-6c-.9,0-1.69-.4-2.24-1.03-.26-.29-.45-.63-.58-1-.11-.31-.18-.63-.18-.97V6.03h12v8ZM20.04,12.03v-6c1.65,0,3,1.35,3,3s-1.35,3-3,3Z"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M9.15,11.51h5.76"
    />
    <path
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      d="M12.03,8.51v5.76"
    />
  </svg>
);

interface UnassignedOrdersPanelProps {
  orders: UnassignedOrder[];
  nextAvailable: { bayNumber: number; seconds: number; isStandby: boolean }[];
  layout?: "strip" | "sidebar";
  selectedOrderId?: string | null;
  onSelectOrder?: (orderId: string) => void;
  onSelectQueueOrder?: (order: UnassignedOrder) => void;
  onClearSelection?: () => void;
  onAssignToBay: (order: UnassignedOrder, bayId: number) => void;
  onMergeOrders?: (firstUid: string, secondUid: string) => void;
}

export const UnassignedOrdersPanel: React.FC<UnassignedOrdersPanelProps> = ({
  orders,
  nextAvailable,
  layout = "strip",
  selectedOrderId,
  onSelectOrder,
  onSelectQueueOrder,
  onClearSelection,
  onAssignToBay,
  onMergeOrders,
}) => {
  const suppressNextClick = useRef(false);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const padBeforePress = useRef<string | null>(null);
  const dragOriginRect = useRef<DOMRect | null>(null);
  const isSidebar = layout === "sidebar";
  const [openPadUid, setOpenPadUid] = useState<string | null>(null);
  const [hoveredBay, setHoveredBay] = useState<number | null>(null);
  const [dragVisual, setDragVisual] = useState<{
    uid: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    if (!openPadUid) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      const openCard = document.querySelector(
        `[data-unassigned-uid="${openPadUid}"]`,
      );
      if (openCard?.contains(target)) return;
      if (target.closest('[data-merge-candidate="true"]')) return;
      // In the scrolling sidebar a press on another card may just be a scroll; that card's
      // own tap or drag replaces the selection, so keep the current one until then.
      if (isSidebar && target.closest("[data-unassigned-uid]")) return;
      setOpenPadUid(null);
      setHoveredBay(null);
      onClearSelection?.();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [openPadUid, onClearSelection, isSidebar]);

  const orderUid = (order: UnassignedOrder) => order.ticketUid || order.id;
  const bayAtPoint = (clientX: number, clientY: number) => {
    const target = document
      .elementsFromPoint(clientX, clientY)
      .map((element) => element.closest<HTMLElement>("[data-bay-target]"))
      .find((element) => {
        const bayId = Number(element?.dataset.bayTarget);
        return element && bayId >= 1 && bayId <= 6;
      });
    const bayId = Number(target?.dataset.bayTarget);
    return bayId >= 1 && bayId <= 6 ? bayId : null;
  };

  const assignToBay = (order: UnassignedOrder, bayId: number) => {
    // 指名の列だけ、限定のカードは上級生の列だけ
    if (!canPlaceOn(order, bayId)) return;
    onAssignToBay(order, bayId);
    setOpenPadUid(null);
    setHoveredBay(null);
  };
  const totalCups = orders.reduce((sum, o) => sum + o.cupCount, 0);
  const visibleOrders = isSidebar ? orders : orders.slice(0, 12);
  const displayedOrders = (() => {
    if (!isSidebar) {
      return visibleOrders.map((order) => ({
        order,
        gridColumn: undefined,
        gridRow: undefined,
      }));
    }

    const groups = new Map<string, UnassignedOrder[]>();
    for (const order of visibleOrders) {
      const group = groups.get(order.id) || [];
      group.push(order);
      groups.set(order.id, group);
    }

    let nextRow = 1;
    const positionedOrders: Array<{
      order: UnassignedOrder;
      gridColumn: number;
      gridRow: number;
    }> = [];
    for (const group of groups.values()) {
      group.forEach((order, index) => {
        positionedOrders.push({
          order,
          gridColumn: (index % 3) + 1,
          gridRow: nextRow + Math.floor(index / 3),
        });
      });
      nextRow += Math.max(1, Math.ceil(group.length / 3));
    }

    return positionedOrders;
  })();

  return (
    <div
      className={`flex h-full flex-col rounded-lg border border-[#cbd5e1] bg-white p-2 shadow-xs ${isSidebar ? "overflow-hidden" : "overflow-visible"}`}
    >
      {/* Header */}
      <div
        className={`${isSidebar ? "shrink-0 pb-2" : "mb-1 h-[34px]"} flex items-center justify-between`}
      >
        <div
          className={`flex ${isSidebar ? "w-full flex-wrap" : ""} items-center gap-2`}
        >
          <ClipboardList className="h-4 w-4 text-red-500" />
          <h2
            className={`${isSidebar ? "text-[18px]" : "text-[16px]"} font-black text-[#0f172a] tracking-tight`}
          >
            {isSidebar ? "カップキュー" : "未割当"}
          </h2>
          <span
            className={`rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-bold font-mono text-red-600 ${isSidebar ? "text-[13px]" : "text-[11px]"}`}
          >
            {orders.length} 件 / {totalCups} 杯
          </span>
          {!isSidebar && (
            <div className="flex items-center gap-1 font-bold text-[10px] text-slate-500">
              <span className="ml-1">次に空く:</span>
              {nextAvailable.map((item, index) => (
                <span
                  key={item.bayNumber}
                  className={`whitespace-nowrap rounded border px-1.5 py-0.5 font-mono ${index === 0 ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-700"}`}
                >
                  #{item.bayNumber}{" "}
                  {item.isStandby ? "待機" : formatMinSec(item.seconds)}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Responsive Grid for up to 12 Orders with Touch-friendly Horizontal/Vertical Scroll */}
      <div
        className={`min-h-0 flex-1 ${isSidebar ? "overflow-auto px-1 py-10" : "overflow-visible"}`}
      >
        <div
          className={
            isSidebar
              ? "grid auto-rows-[112px] grid-cols-3 content-start gap-2"
              : "grid h-full grid-cols-6 grid-rows-2 gap-1.5"
          }
        >
          {displayedOrders.map(({ order, gridColumn, gridRow }, orderIndex) => {
            const surface = cardSurface(order);
            const isOrderBoundary =
              !isSidebar &&
              orderIndex > 0 &&
              displayedOrders[orderIndex - 1]?.order.id !== order.id;
            const openOrder = orders.find(
              (candidate) => orderUid(candidate) === openPadUid,
            );
            const isMergeCandidate = Boolean(
              openOrder && canMergeDripUnits(openOrder, order),
            );
            const isSelected = selectedOrderId === order.id;
            const isDragging = dragVisual?.uid === orderUid(order);
            // The sidebar scrolls and clips its cards, so there the dragged card floats as a
            // fixed copy above the page while the original (and its 1-6 pad) stays put.
            const isFloatingDrag = isDragging && isSidebar;
            const isInlineDrag = isDragging && !isSidebar;
            // While dragging inline, cancel the card's offset on the pad so the finger can slide onto 1-6.
            const padStyle =
              isInlineDrag && dragVisual
                ? {
                    transform: `translate3d(${-dragVisual.x}px, ${-dragVisual.y}px, 0)`,
                  }
                : undefined;
            const cardStyle = order.isRebrew
              ? "bg-red-50 border-red-300 text-slate-900"
              : order.preferredBaristaId
                ? "bg-violet-50 border-violet-300 text-slate-900"
                : surface.className;
            // 入れ直し・指名の色を優先し、それ以外はマスターの画面と同じ背景色（あれば）
            const surfaceStyle =
              order.isRebrew || order.preferredBaristaId
                ? undefined
                : surface.style;
            const idColor = order.isRebrew
              ? "text-red-700"
              : order.preferredBaristaId
                ? "text-violet-700"
                : surface.colored
                  ? ""
                  : surface.dark
                    ? "text-white"
                    : order.totalItemsInOrder && order.totalItemsInOrder > 1
                      ? "text-slate-950"
                      : "text-slate-600";
            const cardBody = (
              <>
                <div className="mb-1 flex items-center justify-between gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`font-black font-mono ${idColor} leading-none tracking-tight ${isSidebar ? "text-[32px]" : "text-[25px]"}`}
                    >
                      {order.id}
                    </span>
                    {order.isRebrew && (
                      <span className="rounded bg-red-600 px-1.5 py-0.5 font-black text-[10px] text-white">
                        入れ直し
                      </span>
                    )}
                    {order.totalItemsInOrder && order.totalItemsInOrder > 1 && (
                      <span className="whitespace-nowrap rounded bg-slate-200 px-1.5 py-0.5 font-black font-mono text-[11px] text-slate-700">
                        {order.itemIndex}/{order.totalItemsInOrder}・計
                        {order.totalOrderCups}杯
                      </span>
                    )}
                  </div>
                  <span
                    className={`${isSidebar ? "text-[20px]" : "text-[17px]"} shrink-0 rounded-md px-2.5 py-1 font-black font-mono leading-none ${order.preferredBaristaId ? (order.cupCount === 1 ? "border border-violet-700 bg-white text-violet-700" : "border border-violet-700 bg-violet-700 text-white") : order.cupCount === 1 ? "border border-black bg-white text-black" : "border border-slate-950 bg-slate-950 text-white"}`}
                  >
                    {order.cupCount}杯
                  </span>
                </div>

                {/* Coffee Name - Clean display without cut off */}
                <div className="flex items-center justify-between gap-2">
                  <h3
                    className={`${isSidebar ? "text-[18px]" : "text-[15px]"} truncate font-bold leading-snug`}
                    title={order.beanName}
                  >
                    {order.beanName} ×{order.cupCount}
                  </h3>
                  <BeanBadge
                    beans={order.beans}
                    className={isSidebar ? "text-[12px]" : ""}
                  />
                  {order.preferredBaristaId && (
                    <span className="whitespace-nowrap font-black text-[12px] text-violet-700">
                      指名 {order.preferredBaristaId}
                    </span>
                  )}
                </div>
              </>
            );

            return (
              <div
                key={order.ticketUid || order.id}
                id={`unassigned-${(order.ticketUid || order.id).replace("#", "")}`}
                data-unassigned-uid={orderUid(order)}
                data-merge-candidate={isMergeCandidate ? "true" : undefined}
                onClick={() => {
                  if (suppressNextClick.current) {
                    suppressNextClick.current = false;
                    return;
                  }
                  if (isMergeCandidate && openPadUid && onMergeOrders) {
                    onMergeOrders(openPadUid, orderUid(order));
                    setOpenPadUid(null);
                    setHoveredBay(null);
                    return;
                  }
                  if (selectedOrderId !== order.id) {
                    if (onSelectQueueOrder) onSelectQueueOrder(order);
                    else if (onSelectOrder) onSelectOrder(order.id);
                  }
                  setOpenPadUid(orderUid(order));
                }}
                onPointerDown={(event) => {
                  // A touch drag ends without a click, so drop any suppression left by it.
                  suppressNextClick.current = false;
                  if (isMergeCandidate) return;
                  if (
                    (event.target as HTMLElement).closest(
                      "button[data-bay-target]",
                    )
                  )
                    return;
                  if (event.pointerType === "mouse" && event.button !== 0)
                    return;
                  event.currentTarget.setPointerCapture(event.pointerId);
                  dragStart.current = { x: event.clientX, y: event.clientY };
                  dragOriginRect.current =
                    event.currentTarget.getBoundingClientRect();
                  padBeforePress.current = openPadUid;
                  // A closed sidebar card may be the start of a scroll, so its pad waits for a tap or drag.
                  if (!isSidebar || openPadUid === orderUid(order))
                    setOpenPadUid(orderUid(order));
                  setHoveredBay(null);
                }}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId))
                    return;
                  const start = dragStart.current;
                  if (
                    !start ||
                    Math.hypot(
                      event.clientX - start.x,
                      event.clientY - start.y,
                    ) < 12
                  )
                    return;
                  // On a closed sidebar card vertical movement belongs to scrolling, not to a drag.
                  const isClosedSidebarCard =
                    isSidebar && openPadUid !== orderUid(order);
                  if (
                    isClosedSidebarCard &&
                    !dragVisual &&
                    Math.abs(event.clientY - start.y) >
                      Math.abs(event.clientX - start.x)
                  ) {
                    return;
                  }
                  if (openPadUid !== orderUid(order)) {
                    // Same as pressing a card in the strip: switching cards drops the old selection.
                    if (openPadUid) onClearSelection?.();
                    setOpenPadUid(orderUid(order));
                  }
                  const bayId = bayAtPoint(event.clientX, event.clientY);
                  setHoveredBay(bayId);
                  setDragVisual({
                    uid: orderUid(order),
                    x: event.clientX - start.x,
                    y: event.clientY - start.y,
                  });
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  const start = dragStart.current;
                  const moved = start
                    ? Math.hypot(
                        event.clientX - start.x,
                        event.clientY - start.y,
                      ) >= 12
                    : false;
                  const bayId = moved
                    ? bayAtPoint(event.clientX, event.clientY)
                    : null;
                  dragStart.current = null;
                  setDragVisual(null);
                  if (bayId) {
                    suppressNextClick.current = true;
                    assignToBay(order, bayId);
                  }
                }}
                onPointerCancel={() => {
                  dragStart.current = null;
                  setDragVisual(null);
                  setHoveredBay(null);
                  // The browser took the gesture as a scroll. The sidebar left the previous pad and
                  // selection alone, so restore it; the strip already cleared both on press.
                  setOpenPadUid(
                    isSidebar || padBeforePress.current === orderUid(order)
                      ? padBeforePress.current
                      : null,
                  );
                }}
                style={{
                  ...surfaceStyle,
                  ...(isSidebar ? { gridColumn, gridRow } : {}),
                  ...(isInlineDrag && dragVisual
                    ? {
                        transform: `translate3d(${dragVisual.x}px, ${dragVisual.y}px, 0)`,
                      }
                    : {}),
                }}
                className={`flex min-h-0 cursor-grab flex-col rounded-lg border transition-[box-shadow,border-color] hover:shadow-md active:cursor-grabbing ${isSidebar && openPadUid !== orderUid(order) ? "touch-pan-y" : "touch-none"} relative select-none ${isSidebar ? "justify-center p-4" : "justify-between p-2"} ${isInlineDrag ? "z-[120] scale-[1.03] overflow-visible opacity-90 shadow-2xl ring-2 ring-blue-500" : openPadUid === orderUid(order) ? "z-40 overflow-visible" : "overflow-hidden"} ${cardStyle} ${
                  isSelected
                    ? "z-10 border-amber-500 shadow-lg ring-4 ring-amber-400"
                    : ""
                }`}
              >
                {isInlineDrag && hoveredBay && (
                  <div className="pointer-events-none absolute top-1 right-1 z-[130] rounded-full bg-blue-700 px-2 py-1 font-black font-mono text-[12px] text-white shadow-md">
                    → {hoveredBay}
                  </div>
                )}
                {isOrderBoundary && (
                  <span
                    className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-slate-500"
                    aria-hidden="true"
                  />
                )}
                {isMergeCandidate && (
                  <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-blue-500 bg-blue-50/90 p-1">
                    <span className="inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 font-black text-[16px] text-white shadow-md">
                      <MergeCupsIcon className="h-5 w-7 shrink-0" />
                      統合する
                    </span>
                  </div>
                )}
                {openPadUid === orderUid(order) && (
                  <>
                    <div
                      className="-top-[38px] absolute right-0 left-0 z-30 grid h-[34px] grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 shadow-xl"
                      style={padStyle}
                      aria-label={`${order.id}の割当先 1から3`}
                    >
                      {[1, 2, 3].map((bayId) => (
                        <button
                          key={bayId}
                          type="button"
                          data-bay-target={bayId}
                          onClick={(event) => {
                            event.stopPropagation();
                            assignToBay(order, bayId);
                          }}
                          disabled={!canPlaceOn(order, bayId)}
                          className={`h-full touch-none rounded-md border font-black font-mono text-[17px] transition-colors disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-500 ${hoveredBay === bayId ? "border-white bg-blue-500 text-white" : order.preferredBaristaId === bayId ? "border-violet-300 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-950"}`}
                        >
                          {bayId}
                        </button>
                      ))}
                    </div>
                    <div
                      className="-bottom-[38px] absolute right-0 left-0 z-30 grid h-[34px] grid-cols-3 gap-1 rounded-lg bg-slate-950 p-1 shadow-xl"
                      style={padStyle}
                      aria-label={`${order.id}の割当先 4から6`}
                    >
                      {[4, 5, 6].map((bayId) => (
                        <button
                          key={bayId}
                          type="button"
                          data-bay-target={bayId}
                          onClick={(event) => {
                            event.stopPropagation();
                            assignToBay(order, bayId);
                          }}
                          disabled={!canPlaceOn(order, bayId)}
                          className={`h-full touch-none rounded-md border font-black font-mono text-[17px] transition-colors disabled:border-slate-700 disabled:bg-slate-700 disabled:text-slate-500 ${hoveredBay === bayId ? "border-white bg-blue-500 text-white" : order.preferredBaristaId === bayId ? "border-violet-300 bg-violet-600 text-white" : "border-slate-300 bg-white text-slate-950"}`}
                        >
                          {bayId}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {/* Linked Order Highlight Pill */}
                {isSelected && (
                  <div className="-top-2.5 absolute left-2 z-20 flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 font-bold text-[9px] text-white shadow-xs">
                    <Sparkles className="h-2.5 w-2.5" />
                    <span>連動選択中</span>
                  </div>
                )}

                {/* Top row: Big ID and Cup/Badge tag */}
                <div className={isFloatingDrag ? "opacity-30" : undefined}>
                  {cardBody}
                </div>
                {isFloatingDrag &&
                  dragVisual &&
                  dragOriginRect.current &&
                  createPortal(
                    <div
                      aria-hidden="true"
                      className={`pointer-events-none fixed z-[1000] flex scale-[1.03] flex-col justify-center rounded-lg border p-4 opacity-90 shadow-2xl ring-2 ring-blue-500 ${cardStyle}`}
                      style={{
                        ...surfaceStyle,
                        left: dragOriginRect.current.left + dragVisual.x,
                        top: dragOriginRect.current.top + dragVisual.y,
                        width: dragOriginRect.current.width,
                        height: dragOriginRect.current.height,
                      }}
                    >
                      {hoveredBay && (
                        <div className="absolute top-1 right-1 rounded-full bg-blue-700 px-2 py-1 font-black font-mono text-[12px] text-white shadow-md">
                          → {hoveredBay}
                        </div>
                      )}
                      {cardBody}
                    </div>,
                    document.body,
                  )}
              </div>
            );
          })}

          {orders.length === 0 && (
            <div className="col-span-full rounded-md border border-dashed py-8 text-center text-slate-400 text-xs">
              レジからのオーダーを待っています
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
