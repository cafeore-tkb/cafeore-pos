import { CircleDot } from "lucide-react";
import type React from "react";
import { isSoon, orderLabel } from "../utils/orderQueue";
import {
  EmptySlotButton,
  LaneBadge,
  NextAvailableChips,
  NextButton,
  PanelHeader,
} from "./BoardParts";
import type { ControlViewProps } from "./ControlWorkspace";
import { OrderCard } from "./OrderCard";
import { UnassignedOrdersPanel } from "./UnassignedOrdersPanel";

// 管制盤 C：左にドリッパーの行（抽出中・待機・次へ）、右に未割当の縦リスト。待機のカードはタップで詳細を開く
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
}) => (
  <section
    className="grid h-full min-h-0 grid-cols-2 gap-2"
    aria-label="Cコントロール画面"
  >
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
      <PanelHeader icon={CircleDot} title="ドリッパー">
        <NextAvailableChips nextAvailable={nextAvailable} />
      </PanelHeader>

      <div className="grid min-h-0 flex-1 grid-rows-6 divide-y divide-slate-200">
        {baristas.map((barista) => {
          const [current, ...waiting] = barista.queue;
          const isLinked = barista.queue.some(
            (ticket) => orderLabel(ticket) === selectedOrderId,
          );
          return (
            <article
              key={barista.id}
              data-bay-target={barista.id}
              className={`relative isolate flex min-h-0 flex-col gap-1 overflow-hidden p-1.5 ${isLinked ? "bg-amber-50 ring-2 ring-amber-400 ring-inset" : "bg-white"}`}
            >
              <LaneBadge bayId={barista.id} />
              <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)_52px] items-stretch gap-1.5">
                {current ? (
                  <OrderCard
                    card={current}
                    size="sm"
                    className={
                      isSoon(barista, currentTimeSec)
                        ? "ring-2 ring-red-400 ring-inset"
                        : ""
                    }
                  />
                ) : (
                  <span className="flex items-center justify-center rounded-lg border border-slate-300 border-dashed font-bold text-[12px] text-slate-400">
                    待機中
                  </span>
                )}

                <div className="flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {waiting.map((ticket) => (
                    <OrderCard
                      key={ticket.ticketUid}
                      card={ticket}
                      size="sm"
                      onClick={() => {
                        if (selectedOrderId !== orderLabel(ticket))
                          onSelectOrder(orderLabel(ticket));
                        onOpenTicketDetail(ticket);
                      }}
                      className="min-w-[180px] flex-1 cursor-pointer border-l-4 border-l-blue-500 hover:ring-2 hover:ring-blue-400"
                    />
                  ))}
                  {waiting.length === 0 && (
                    <EmptySlotButton
                      onClick={() => onOpenEmptySlot(barista.id)}
                      className="flex-1"
                    />
                  )}
                </div>

                <NextButton
                  barista={barista}
                  nowSec={currentTimeSec}
                  onAdvance={onAdvanceBay}
                  className="min-w-0 overflow-hidden text-[12px]"
                />
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
