import { readableTextColor } from "@cafeore/common";
import { Check, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { OrderTicket } from "../types";
import { cardHasBean } from "../utils/beans";
import { BeanBadge } from "./BeanBadge";

interface TicketCardProps {
  ticket: OrderTicket;
  // 豆で絞り込む（在庫対象の ID）
  highlightFilter: string | null;
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
  onOpenDetail: (ticket: OrderTicket) => void;
  actionTicketKey?: string | null;
  currentBayId: number;
  onMoveTicket: (ticket: OrderTicket, bayId: number, toFront?: boolean) => void;
  onReturnToUnassigned: (ticket: OrderTicket) => void;
  onCloseAction: () => void;
  widthPx?: number;
}

export const TicketCard: React.FC<TicketCardProps> = ({
  ticket,
  highlightFilter,
  selectedOrderId,
  onOpenDetail,
  actionTicketKey,
  currentBayId,
  onMoveTicket,
  onReturnToUnassigned,
  onCloseAction,
  widthPx,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const suppressNextClick = useRef(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragTargetBay, setDragTargetBay] = useState<number | null>(null);
  const isMatchFilter =
    !highlightFilter || cardHasBean(ticket, highlightFilter);
  const isOrderSelected = selectedOrderId === ticket.id;

  // 左の線は、マスターの画面の色の設定の色（終わった・指名で背景を塗らないカードでも商品が分かるように）。
  // 設定が無ければ灰色。商品の種類で色を決め打ちしない
  const leftBorderColor = ticket.color ? "" : "border-l-slate-400";

  const isCompleted = ticket.status === "completed";
  const isNamed = Boolean(ticket.preferredBaristaId);
  // 盤面のカードは、マスターの画面と同じ背景色で塗る（終わった・指名のカードはそれぞれの色を優先）
  const masterColor =
    ticket.color && !isCompleted && !isNamed ? ticket.color : undefined;
  // 文字色は背景色から決める（POS と共通の readableTextColor）
  const masterTextColor = masterColor
    ? readableTextColor(masterColor)
    : undefined;
  const ticketKey = ticket.ticketUid || `${ticket.id}-${ticket.itemIndex || 1}`;
  const isActionOpen =
    ticket.status === "scheduled" && actionTicketKey === ticketKey;
  // While dragging, cancel the card's offset on the pad so the finger can slide onto 1-6.
  const padDragStyle = dragOffset
    ? { transform: `translate3d(${-dragOffset.x}px, ${-dragOffset.y}px, 0)` }
    : {};

  useEffect(() => {
    if (!isActionOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) onCloseAction();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [isActionOpen, onCloseAction]);

  const bayAtPoint = (clientX: number, clientY: number) => {
    const elements = document.elementsFromPoint(clientX, clientY);
    // A 1-6 pad button decides on its own: releasing on this card's own (disabled) number
    // must not fall through to the lane underneath the pad.
    const padButton = elements.find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.matches("button[data-bay-target]"),
    );
    if (padButton) {
      const bayId = Number(padButton.dataset.bayTarget);
      return bayId >= 1 && bayId <= 6 && bayId !== currentBayId ? bayId : null;
    }
    const lane = elements
      .map((element) => element.closest<HTMLElement>("[data-bay-target]"))
      .find((element) => {
        const bayId = Number(element?.dataset.bayTarget);
        return element && bayId >= 1 && bayId <= 6 && bayId !== currentBayId;
      });
    return lane ? Number(lane.dataset.bayTarget) : null;
  };

  const finishDrag = () => {
    dragStart.current = null;
    setDragOffset(null);
    setDragTargetBay(null);
  };

  return (
    <div
      ref={cardRef}
      onClick={() => {
        if (suppressNextClick.current) {
          suppressNextClick.current = false;
          return;
        }
        if (ticket.status !== "scheduled") return;
        if (isActionOpen) {
          onReturnToUnassigned(ticket);
          onCloseAction();
          return;
        }
        onOpenDetail(ticket);
      }}
      onPointerDown={(event) => {
        // A touch drag ends without a click, so drop any suppression left by it.
        suppressNextClick.current = false;
        if (ticket.status !== "scheduled") return;
        if ((event.target as HTMLElement).closest("button")) return;
        if (event.pointerType === "mouse" && event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        dragStart.current = { x: event.clientX, y: event.clientY };
      }}
      onPointerMove={(event) => {
        if (
          !event.currentTarget.hasPointerCapture(event.pointerId) ||
          !dragStart.current
        )
          return;
        const x = event.clientX - dragStart.current.x;
        const y = event.clientY - dragStart.current.y;
        if (!dragOffset && Math.hypot(x, y) < 10) return;
        event.preventDefault();
        setDragOffset({ x, y });
        setDragTargetBay(bayAtPoint(event.clientX, event.clientY));
      }}
      onPointerUp={(event) => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
        event.currentTarget.releasePointerCapture(event.pointerId);
        const start = dragStart.current;
        const moved = start
          ? Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 10
          : false;
        const targetBay = moved
          ? bayAtPoint(event.clientX, event.clientY)
          : null;
        finishDrag();
        if (moved) {
          suppressNextClick.current = true;
          if (
            targetBay &&
            (!ticket.preferredBaristaId ||
              ticket.preferredBaristaId === targetBay)
          ) {
            // 同じドリッパーの「先頭」に落としたら、待機の先頭へ
            onMoveTicket(ticket, targetBay, targetBay === currentBayId);
            onCloseAction();
          }
        }
      }}
      onPointerCancel={finishDrag}
      id={`ticket-${ticket.ticketUid || ticket.id.replace("#", "")}`}
      style={{
        ...(masterColor
          ? { backgroundColor: masterColor, color: masterTextColor }
          : {}),
        ...(ticket.color ? { borderLeftColor: ticket.color } : {}),
        ...(widthPx ? { width: `${widthPx}px` } : {}),
        ...(dragOffset
          ? {
              transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
            }
          : {}),
      }}
      className={`group relative h-full ${dragOffset ? `${isActionOpen ? "overflow-visible" : "overflow-hidden"} z-[120] scale-[1.03] opacity-90 shadow-2xl ring-2 ring-blue-500` : isActionOpen ? "z-[80] overflow-visible" : "overflow-hidden"} min-w-[135px] shrink-0 rounded-lg border-2 border-l-[5px] ${leftBorderColor} flex select-none flex-col justify-center px-2 py-1.5 transition-[box-shadow,border-color] ${ticket.status === "scheduled" ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-default touch-manipulation"} ${
        isCompleted
          ? "border-slate-200 bg-slate-100 text-slate-500 opacity-50 hover:opacity-70"
          : isNamed
            ? "border-violet-300 bg-violet-50 shadow-xs hover:border-violet-400 hover:shadow-md"
            : "border-[#cbd5e1] bg-white shadow-xs hover:border-slate-400 hover:shadow-md"
      } ${
        isOrderSelected
          ? "z-20 scale-[1.02] border-amber-500 bg-amber-50/95 shadow-xl ring-4 ring-amber-400"
          : ""
      } ${!isMatchFilter ? "opacity-25 blur-[0.5px]" : ""}`}
    >
      {dragOffset && dragTargetBay && (
        <div className="pointer-events-none absolute top-1 right-1 z-[130] rounded-full bg-blue-700 px-2 py-1 font-black font-mono text-[12px] text-white shadow-md">
          → {dragTargetBay}
        </div>
      )}
      {isActionOpen && (
        <>
          {[1, 2, 3].map((bayId, index) => {
            // 今のドリッパーのボタンは「先頭」（このドリッパーの待機の先頭へ）
            const disabled = Boolean(
              ticket.preferredBaristaId && ticket.preferredBaristaId !== bayId,
            );
            return (
              <button
                key={bayId}
                type="button"
                data-bay-target={bayId}
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveTicket(ticket, bayId, bayId === currentBayId);
                  onCloseAction();
                }}
                className="-top-[38px] absolute z-[90] h-[34px] touch-none rounded-md border bg-white font-black font-mono text-[17px] shadow-lg disabled:bg-slate-200 disabled:text-slate-400"
                style={{
                  left: `${index * 33.333}%`,
                  width: "33.333%",
                  ...padDragStyle,
                }}
              >
                {bayId === currentBayId ? "先頭" : bayId}
              </button>
            );
          })}
          {[4, 5, 6].map((bayId, index) => {
            // 今のドリッパーのボタンは「先頭」（このドリッパーの待機の先頭へ）
            const disabled = Boolean(
              ticket.preferredBaristaId && ticket.preferredBaristaId !== bayId,
            );
            return (
              <button
                key={bayId}
                type="button"
                data-bay-target={bayId}
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onMoveTicket(ticket, bayId, bayId === currentBayId);
                  onCloseAction();
                }}
                className="-bottom-[38px] absolute z-[90] h-[34px] touch-none rounded-md border bg-white font-black font-mono text-[17px] shadow-lg disabled:bg-slate-200 disabled:text-slate-400"
                style={{
                  left: `${index * 33.333}%`,
                  width: "33.333%",
                  ...padDragStyle,
                }}
              >
                {bayId === currentBayId ? "先頭" : bayId}
              </button>
            );
          })}
          <div className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center rounded-md bg-red-500/10">
            <X className="h-10 w-10 stroke-[3] text-red-600/35" />
          </div>
        </>
      )}
      {/* Top row: Ticket ID and Badges */}
      <div>
        <div className="mb-1 flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1">
            {/* Large Order Number Label */}
            <span
              className={`font-black font-mono text-[22px] leading-none tracking-tight ${
                isOrderSelected
                  ? "font-black text-amber-900"
                  : isNamed
                    ? "text-violet-700"
                    : isCompleted
                      ? "text-slate-500"
                      : masterColor
                        ? ""
                        : ticket.totalItemsInOrder &&
                            ticket.totalItemsInOrder > 1
                          ? "text-slate-950"
                          : "text-slate-600"
              }`}
            >
              {ticket.id}
            </span>

            {/* Cup count badge */}
            <span className="shrink-0 whitespace-nowrap rounded-md bg-slate-950 px-2 py-1 font-black font-mono text-[15px] text-white leading-none shadow-2xs">
              {ticket.cupCount}杯
            </span>

            {ticket.preferredBaristaId && (
              <span className="rounded bg-violet-700 px-1.5 py-0.5 font-black text-[11px] text-white">
                指名
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {isCompleted && (
              <span className="flex items-center gap-0.5 rounded border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 font-bold text-[10px] text-emerald-800 leading-none">
                <Check className="h-3 w-3" />
                <span className="sr-only">完了</span>
              </span>
            )}
          </div>
        </div>

        {/* Coffee Name */}
        <div className="flex items-center gap-1.5">
          <span
            className={`max-w-[65%] shrink-0 truncate font-bold text-[14px] leading-tight tracking-tight ${
              isOrderSelected
                ? "font-black text-amber-950"
                : isCompleted
                  ? "text-slate-600"
                  : masterColor
                    ? ""
                    : "text-slate-900"
            }`}
            title={ticket.beanName}
          >
            {ticket.beanName}
          </span>
          <BeanBadge beans={ticket.beans} typeName={ticket.typeName} />
          {ticket.totalItemsInOrder && ticket.totalItemsInOrder > 1 && (
            <span className="ml-auto shrink-0 whitespace-nowrap rounded bg-slate-200 px-1.5 py-0.5 font-black font-mono text-[10px] text-slate-700">
              {ticket.itemIndex}/{ticket.totalItemsInOrder}・計
              {ticket.totalOrderCups}杯
            </span>
          )}
        </div>

        {/* Order Notes (e.g. チャンプ 2杯 + 俺ブレ 1杯) */}
      </div>
    </div>
  );
};
