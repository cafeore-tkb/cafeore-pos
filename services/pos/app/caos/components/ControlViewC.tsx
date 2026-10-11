import { CircleDot } from "lucide-react";
import type React from "react";
import { orderLabel } from "../logic/cards";
import { laneActive } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
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

// 管制盤 C：左にドリッパーの行（抽出中・待機・次へ）、右に未割当の縦リスト。
// 待機のカードはタップで詳細（移動・先頭へ・未割当に戻す）。未割当のカードを待機のカードの上に落とすと、そのカードの前へ
export const ControlViewC: React.FC<ControlViewProps> = ({
  lanes,
  unassignedOrders,
  looks,
  nextAvailable,
  nowMs,
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
        {lanes.map((bay) => {
          const lane = laneStatus(bay, nowMs);
          const { current } = lane;
          const isLinked = laneActive(bay).some(
            (card) => orderLabel(card) === selectedOrderId,
          );
          return (
            <article
              key={bay.id}
              data-bay-target={bay.id}
              className={`relative isolate flex min-h-0 flex-col gap-1 overflow-hidden p-1.5 ${isLinked ? "bg-amber-50 ring-2 ring-amber-400 ring-inset" : "bg-white"}`}
            >
              <LaneBadge bayId={bay.id} />
              <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)_52px] items-stretch gap-1.5">
                {current ? (
                  <OrderCard
                    card={current}
                    look={looks.get(current.key)}
                    size="sm"
                    // 抽出中が無い列の先頭（「次へ」で始める）は、まだ待機のカード
                    {...(current.status === "queued" && {
                      "data-queued-ticket": current.key,
                      "data-ticket-label": orderLabel(current),
                      onClick: () => onOpenTicketDetail(current),
                    })}
                    className={`${current.status === "queued" ? "cursor-pointer hover:ring-2 hover:ring-blue-400" : ""} ${lane.soon ? "ring-2 ring-red-400 ring-inset" : ""}`}
                  />
                ) : (
                  <span className="flex items-center justify-center rounded-lg border border-slate-300 border-dashed font-bold text-[12px] text-slate-400">
                    待機中
                  </span>
                )}

                <div className="flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {lane.waiting.map((ticket) => (
                    <OrderCard
                      key={ticket.key}
                      card={ticket}
                      look={looks.get(ticket.key)}
                      size="sm"
                      data-queued-ticket={ticket.key}
                      data-ticket-label={orderLabel(ticket)}
                      onClick={() => onOpenTicketDetail(ticket)}
                      className="min-w-[180px] flex-1 cursor-pointer border-l-4 border-l-blue-500 hover:ring-2 hover:ring-blue-400"
                    />
                  ))}
                  {lane.waiting.length === 0 && (
                    <EmptySlotButton
                      onClick={() => onOpenEmptySlot(bay.id)}
                      className="flex-1"
                    />
                  )}
                </div>

                <NextButton
                  bayId={bay.id}
                  active={Boolean(current)}
                  soon={lane.soon}
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
        looks={looks}
        nextAvailable={nextAvailable}
        selectedOrderId={selectedOrderId}
        onSelectOrder={onSelectOrder}
        onAssignToBay={onAssignToBay}
      />
    </aside>
  </section>
);
