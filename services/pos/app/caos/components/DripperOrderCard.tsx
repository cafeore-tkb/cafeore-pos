import { Plus } from "lucide-react";
import type React from "react";
import type { OrderTicket } from "../types";
import { MENU_PRESENTATION } from "../utils/menuPresentation";
import { BeanBadge } from "./BeanBadge";

interface DripperOrderCardProps {
  kind: "current" | "waiting";
  ticket?: OrderTicket;
  remainingLabel?: string;
  queueCount?: number;
  queuePosition?: number;
  isImminent?: boolean;
  emptyLabel: string;
  onClick?: () => void;
}

const cardTheme = (ticket: OrderTicket) => {
  const menu = MENU_PRESENTATION[ticket.beanCode];
  if (ticket.isRebrew)
    return {
      card: "border-red-300 bg-red-50 text-slate-900",
      id: "text-red-700",
    };
  if (ticket.preferredBaristaId) {
    return {
      card: "border-violet-300 bg-violet-50 text-slate-900",
      id: "text-violet-700",
    };
  }
  return {
    card: `${menu.cardClass} ${menu.family === "premium" ? "text-white" : "text-slate-900"}`,
    id: menu.family === "premium" ? "text-white" : "text-slate-600",
  };
};

export const DripperOrderCard: React.FC<DripperOrderCardProps> = ({
  kind,
  ticket,
  remainingLabel,
  queueCount = 0,
  queuePosition,
  isImminent = false,
  emptyLabel,
  onClick,
}) => {
  const theme = ticket ? cardTheme(ticket) : null;
  const isWaiting = kind === "waiting";

  return (
    <button
      type="button"
      disabled={!onClick}
      onClick={onClick}
      className={`flex h-full min-w-[180px] flex-col justify-center overflow-hidden rounded-lg border px-2.5 py-1.5 text-left shadow-xs transition-colors ${
        ticket && theme
          ? `${theme.card} ${isImminent ? "ring-2 ring-red-400 ring-inset" : ""}`
          : "border-slate-300 border-dashed bg-white text-slate-400"
      } ${isWaiting ? "w-full flex-1 border-l-4 border-l-blue-500" : "w-[180px]"} ${onClick ? "hover:ring-2 hover:ring-blue-400" : ""}`}
    >
      {ticket && theme ? (
        <>
          <div className="mt-0.5 flex w-full min-w-0 items-center justify-between gap-1">
            <span
              className={`truncate font-black font-mono text-[18px] leading-none ${theme.id}`}
            >
              {ticket.id}
            </span>
            <span className="shrink-0 rounded bg-slate-950 px-1.5 py-0.5 font-black font-mono text-[10px] text-white leading-none">
              {ticket.cupCount}杯
            </span>
          </div>
          <div className="mt-1 flex w-full min-w-0 items-center gap-1">
            <span className="truncate font-bold text-[11px]">
              {queuePosition ? `${queuePosition}. ` : ""}
              {ticket.beanName}
            </span>
            <BeanBadge beans={ticket.beans} />
          </div>
        </>
      ) : (
        <span className="mx-auto flex items-center gap-1 font-bold text-[12px]">
          {isWaiting && <Plus className="h-3.5 w-3.5" />}
          {emptyLabel}
        </span>
      )}
    </button>
  );
};
