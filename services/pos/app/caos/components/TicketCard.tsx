import { Check, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { OrderTicket } from "../types";
import { cardSurface } from "../utils/cardSurface";
import { bayTargetAt } from "../utils/lanes";
import { orderLabel } from "../utils/orderQueue";
import { BayPad } from "./BayPad";
import { BeanBadge } from "./BeanBadge";

interface TicketCardProps {
  ticket: OrderTicket;
  selectedOrderId: string | null;
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
  const isOrderSelected = selectedOrderId === orderLabel(ticket);

  const isCompleted = ticket.status === "completed";
  const isNamed = Boolean(ticket.preferredBaristaId);
  // カードの色（cardSurface）。終わったカードは薄い灰色
  const surface = isCompleted
    ? {
        className:
          "border-slate-200 bg-slate-100 text-slate-500 opacity-50 hover:opacity-70",
        style: undefined,
      }
    : cardSurface(ticket);
  const isActionOpen =
    ticket.status === "scheduled" && actionTicketKey === ticket.ticketUid;
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

  // 指の下のドリッパー（今のドリッパーと、指名以外のドリッパーは置けない）
  const bayAtPoint = (clientX: number, clientY: number) =>
    bayTargetAt(clientX, clientY, {
      from: currentBayId,
      preferred: ticket.preferredBaristaId,
    });

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
          if (targetBay) {
            onMoveTicket(ticket, targetBay);
            onCloseAction();
          }
        }
      }}
      onPointerCancel={finishDrag}
      style={{
        ...surface.style,
        ...(widthPx ? { width: `${widthPx}px` } : {}),
        ...(dragOffset
          ? {
              transform: `translate3d(${dragOffset.x}px, ${dragOffset.y}px, 0)`,
            }
          : {}),
      }}
      className={`group relative h-full ${dragOffset ? `${isActionOpen ? "overflow-visible" : "overflow-hidden"} z-[120] scale-[1.03] opacity-90 shadow-2xl ring-2 ring-blue-500` : isActionOpen ? "z-[80] overflow-visible" : "overflow-hidden"} flex min-w-[135px] shrink-0 select-none flex-col justify-center rounded-lg border-2 border-l-[5px] border-l-slate-400 px-2 py-1.5 transition-[box-shadow,border-color] ${ticket.status === "scheduled" ? "cursor-grab touch-none active:cursor-grabbing" : "cursor-default touch-manipulation"} ${surface.className} ${isCompleted ? "" : "shadow-xs hover:shadow-md"} ${
        isOrderSelected
          ? "z-20 scale-[1.02] border-amber-500 bg-amber-50/95 shadow-xl ring-4 ring-amber-400"
          : ""
      }`}
    >
      {dragOffset && dragTargetBay && (
        <div className="pointer-events-none absolute top-1 right-1 z-[130] rounded-full bg-blue-700 px-2 py-1 font-black font-mono text-[12px] text-white shadow-md">
          → {dragTargetBay}
        </div>
      )}
      {isActionOpen && (
        <>
          <BayPad
            preferredBaristaId={ticket.preferredBaristaId}
            currentBayId={currentBayId}
            hoveredBay={dragTargetBay}
            style={padDragStyle}
            onPick={(bayId, toFront) => {
              onMoveTicket(ticket, bayId, toFront);
              onCloseAction();
            }}
          />
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
                    : ticket.totalItemsInOrder > 1
                      ? ""
                      : "opacity-75"
              }`}
            >
              {orderLabel(ticket)}
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
              isOrderSelected ? "font-black text-amber-950" : ""
            }`}
            title={ticket.beanName}
          >
            {ticket.beanName}
          </span>
          <BeanBadge card={ticket} />
          {ticket.totalItemsInOrder > 1 && (
            <span className="ml-auto shrink-0 whitespace-nowrap rounded bg-slate-200 px-1.5 py-0.5 font-black font-mono text-[10px] text-slate-700">
              {ticket.itemIndex}/{ticket.totalItemsInOrder}・計
              {ticket.totalOrderCups}杯
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
