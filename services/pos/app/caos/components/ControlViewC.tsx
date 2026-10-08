import { CAOS_SOON_SEC } from "@cafeore/common";
import { ArrowRightCircle, CircleDot, RotateCcw } from "lucide-react";
import type React from "react";
import { laneOrdinal } from "../utils/lanes";
import { activeRemainingSec, orderLabel } from "../utils/orderQueue";
import type { ControlViewProps } from "./ControlWorkspace";
import { DripperOrderCard } from "./DripperOrderCard";
import { NextAvailableChips } from "./NextAvailableChips";
import { UnassignedOrdersPanel } from "./UnassignedOrdersPanel";

export const ControlViewC: React.FC<ControlViewProps> = ({
  baristas,
  unassignedOrders,
  nextAvailable,
  currentTimeSec,
  selectedOrderId,
  onSelectOrder,
  onAdvanceBay,
  onOpenTicketDetail,
  onOpenEmptySlot,
  onAssignToBay,
}) => {
  return (
    <section
      className="grid h-full min-h-0 grid-cols-2 gap-2"
      aria-label="Cコントロール画面"
    >
      <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
        <header className="flex h-11 shrink-0 items-center gap-2 border-slate-200 border-b bg-slate-50 px-3">
          <CircleDot className="h-4 w-4 text-emerald-600" />
          <h2 className="shrink-0 font-black text-[15px] text-slate-950">
            ドリッパー
          </h2>
          <NextAvailableChips nextAvailable={nextAvailable} />
        </header>

        <div className="grid min-h-0 flex-1 grid-rows-6 divide-y divide-slate-200">
          {baristas.map((barista) => {
            const current = barista.queue[0];
            const waitingQueue = barista.queue.slice(1);
            const seconds = activeRemainingSec(barista, currentTimeSec);
            const isImminent = Boolean(current && seconds <= CAOS_SOON_SEC);
            const isLinked = Boolean(
              selectedOrderId &&
                barista.queue.some(
                  (ticket) => orderLabel(ticket) === selectedOrderId,
                ),
            );

            return (
              <article
                key={barista.id}
                data-bay-target={barista.id}
                className={`relative isolate flex min-h-0 flex-col gap-1 overflow-hidden p-1.5 transition-colors ${isLinked ? "bg-amber-50 ring-2 ring-amber-400 ring-inset" : "bg-white"}`}
              >
                <div className="flex h-8 shrink-0 items-center justify-between gap-2 overflow-hidden px-0.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="flex h-7 min-w-9 shrink-0 items-center justify-center rounded-md bg-slate-950 px-1 font-black font-mono text-[13px] text-white">
                      {laneOrdinal(barista.bayNumber)}
                    </div>
                  </div>
                </div>

                <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)_52px] items-stretch gap-1.5">
                  <DripperOrderCard
                    kind="current"
                    ticket={current}
                    isImminent={isImminent}
                    emptyLabel="待機中"
                  />

                  <div className="flex min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {waitingQueue.length > 0 ? (
                      waitingQueue.map((ticket, index) => (
                        <DripperOrderCard
                          key={ticket.ticketUid}
                          kind="waiting"
                          ticket={ticket}
                          queuePosition={index + 1}
                          emptyLabel="待ちへ割当"
                          onClick={() => {
                            if (selectedOrderId !== orderLabel(ticket))
                              onSelectOrder(orderLabel(ticket));
                            onOpenTicketDetail(ticket);
                          }}
                        />
                      ))
                    ) : (
                      <DripperOrderCard
                        kind="waiting"
                        emptyLabel="待ちへ割当"
                        onClick={() => onOpenEmptySlot(barista.id)}
                      />
                    )}
                  </div>

                  <button
                    type="button"
                    disabled={!current}
                    onClick={() => onAdvanceBay(barista.id)}
                    className={`flex min-w-0 items-center justify-center gap-0.5 overflow-hidden rounded-lg font-black text-[12px] ${current ? "bg-emerald-700 text-white" : "bg-slate-200 text-slate-500"}`}
                  >
                    {current ? (
                      <>
                        <span>次へ</span>
                        <ArrowRightCircle className="h-4 w-4" />
                      </>
                    ) : (
                      <>
                        <span>待機</span>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <aside className="min-h-0 min-w-0">
        <UnassignedOrdersPanel
          layout="sidebar"
          orders={unassignedOrders}
          nextAvailable={nextAvailable}
          selectedOrderId={selectedOrderId}
          onSelectOrder={onSelectOrder}
          onAssignToBay={onAssignToBay}
        />
      </aside>
    </section>
  );
};
