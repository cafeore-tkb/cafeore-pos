import { ArrowRight, Undo2, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import type { OrderTicket } from "../types";
import { nominationText } from "../utils/nomination";
import { BeanBadge } from "./BeanBadge";

interface TicketDetailModalProps {
  ticket: OrderTicket | null;
  currentBayId: number | null;
  onClose: () => void;
  onMoveTicket: (ticket: OrderTicket, bayId: number, toFront?: boolean) => void;
  onReturnToUnassigned: (ticket: OrderTicket) => void;
}

export const TicketDetailModal: React.FC<TicketDetailModalProps> = ({
  ticket,
  currentBayId,
  onClose,
  onMoveTicket,
  onReturnToUnassigned,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [onClose]);
  if (ticket?.status !== "scheduled") return null;

  return (
    <div className="pointer-events-none fixed top-[56px] right-0 bottom-0 z-50 select-none">
      <div
        ref={panelRef}
        className="pointer-events-auto flex h-full w-[min(420px,42vw)] min-w-[360px] flex-col border-slate-300 border-l bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-slate-200 border-b px-5 py-4">
          <div>
            <div className="font-black text-[12px] text-slate-500">
              未開始オーダーの移動
            </div>
            <div className="mt-1 flex items-center gap-3">
              <span className="font-black font-mono text-[28px]">
                {ticket.id}
              </span>
              <span className="font-bold text-[18px]">{ticket.beanName}</span>
              <BeanBadge
                beans={ticket.beans}
                typeName={ticket.typeName}
                className="text-[12px]"
              />
              <span className="rounded-md bg-slate-950 px-2.5 py-1 font-black font-mono text-[17px] text-white">
                {ticket.cupCount}杯
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-100"
            aria-label="閉じる"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="space-y-5 p-5">
          <section>
            <h3 className="mb-2 font-black text-[14px] text-slate-700">
              他のドリッパーへ移動・先頭へ
            </h3>
            <div className="grid grid-cols-3 gap-2">
              {[1, 2, 3, 4, 5, 6].map((bayId) => {
                // 今のドリッパーのボタンは、このドリッパーの待機の先頭へ
                const disabled = Boolean(
                  ticket.preferredBaristaId &&
                    ticket.preferredBaristaId !== bayId,
                );
                return (
                  <button
                    key={bayId}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onMoveTicket(ticket, bayId, bayId === currentBayId);
                      onClose();
                    }}
                    className="h-16 touch-manipulation rounded-xl border-2 border-slate-300 bg-white font-black font-mono text-[24px] active:bg-slate-900 active:text-white disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-300"
                  >
                    {bayId === currentBayId ? `${bayId} 先頭へ` : bayId}
                  </button>
                );
              })}
            </div>
            {ticket.preferredBaristaId && (
              <p className="mt-2 font-bold text-[13px] text-violet-700">
                指名オーダー：{nominationText(ticket)}のドリッパーのみ
              </p>
            )}
          </section>

          <button
            type="button"
            onClick={() => {
              onReturnToUnassigned(ticket);
              onClose();
            }}
            className="flex min-h-[60px] w-full touch-manipulation items-center justify-center gap-2 rounded-xl border-2 border-red-200 bg-red-50 px-4 font-black text-[16px] text-red-700 active:bg-red-100"
          >
            <Undo2 className="h-5 w-5" />
            未割り当に戻す
          </button>

          <div className="flex items-center gap-2 rounded-lg bg-slate-100 p-3 font-bold text-[13px] text-slate-500">
            <ArrowRight className="h-4 w-4" />
            抽出開始後はここから変更できません
          </div>
        </div>
      </div>
    </div>
  );
};
