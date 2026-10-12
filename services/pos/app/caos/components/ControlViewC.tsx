import { CircleDot } from "lucide-react";
import type React from "react";
import { orderLabel, sharesOrder } from "../logic/cards";
import { laneActive, pendingNominatedCups } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
import {
  DripperIndicator,
  EmptySlotButton,
  NextAvailableChips,
  NextButton,
  PanelHeader,
} from "./BoardParts";
import type { ControlViewProps } from "./ControlWorkspace";
import { LaneAbility, LaneChangeButton, LaneName } from "./LaneParts";
import { OrderCard } from "./OrderCard";
import { OrderQueuePanel } from "./UnassignedOrdersPanel";

// 管制盤 C：左にドリッパーの行、右に注文の列（未割当と、ドリッパーに置いたカードを注文番号の順に）。
// 行は時系列の順に、ドリッパーの番号（列の状態）・抽出中・「次へ」・待機。
// 待機のカードはタップで詳細（移動・先頭へ・未割当に戻す・統合の解除）。未割当のカードを待機のカードの上に落とすと、そのカードの前へ
// （統合できる待機・抽出中のカードの上（待機は右の部分）なら統合）
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
  onOpenRebrew,
  onCancelEmergency,
  onOpenEmptySlot,
  onOpenLane,
  onAssignToBay,
  onMergeOrders,
  onSplitCup,
}) => (
  <section
    className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_524px] gap-2"
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
          const isLinked = laneActive(bay).some((card) =>
            sharesOrder(card, selectedOrderId),
          );
          return (
            <article
              key={bay.id}
              data-bay-target={bay.id}
              className={`relative isolate flex min-h-0 items-stretch gap-2 p-1.5 ${isLinked ? "bg-amber-50 ring-2 ring-amber-400 ring-inset" : "bg-white"}`}
            >
              <DripperIndicator
                bayId={bay.id}
                status={lane}
                nominatedCups={pendingNominatedCups(unassignedOrders, bay.id)}
                onOpenLane={onOpenLane}
                className="w-[80px]"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex min-w-0 items-center gap-1.5">
                  <LaneName
                    dripper={bay.id}
                    className="font-black text-[14px] text-slate-950"
                  />
                  <LaneAbility dripper={bay.id} />
                  <LaneChangeButton
                    dripper={bay.id}
                    layout="inline"
                    className="ml-auto h-6"
                  />
                </div>
                <div className="grid min-h-0 flex-1 grid-cols-[156px_72px_minmax(0,1fr)] items-stretch gap-1.5">
                  {current ? (
                    <OrderCard
                      card={current}
                      look={looks.get(current.key)}
                      size="sm"
                      data-merge-target={current.key}
                      data-ticket-label={orderLabel(current)}
                      // 抽出中が無い列の先頭（「次へ」で始める）は、まだ待機のカード。抽出中のカードは入れ直し
                      {...(current.status === "queued"
                        ? {
                            "data-queued-ticket": current.key,
                            onClick: () => onOpenTicketDetail(current),
                          }
                        : { onClick: () => onOpenRebrew?.(current) })}
                      className={
                        current.status === "queued"
                          ? "cursor-pointer hover:ring-2 hover:ring-blue-400"
                          : ""
                      }
                    />
                  ) : (
                    <span className="rounded-lg border border-slate-300 border-dashed" />
                  )}

                  <NextButton
                    bayId={bay.id}
                    active={Boolean(current)}
                    locked={lane.nextLocked}
                    onAdvance={onAdvanceBay}
                    className="text-[15px]"
                  />

                  <div className="flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {lane.waiting.map((ticket) => (
                      <OrderCard
                        key={ticket.key}
                        card={ticket}
                        look={looks.get(ticket.key)}
                        size="sm"
                        data-queued-ticket={ticket.key}
                        data-merge-target={ticket.key}
                        data-ticket-label={orderLabel(ticket)}
                        onClick={() => onOpenTicketDetail(ticket)}
                        className="w-[150px] shrink-0 cursor-pointer hover:ring-2 hover:ring-blue-400"
                      />
                    ))}
                    {lane.waiting.length === 0 && (
                      <EmptySlotButton
                        onClick={() => onOpenEmptySlot(bay.id)}
                        className="flex-1"
                      />
                    )}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>

    <aside className="min-h-0 min-w-0">
      <OrderQueuePanel
        orders={unassignedOrders}
        lanes={lanes}
        looks={looks}
        selectedOrderId={selectedOrderId}
        onSelectOrder={onSelectOrder}
        onAssignToBay={onAssignToBay}
        onMergeOrders={onMergeOrders}
        onSplitCup={onSplitCup}
        onCancelEmergency={onCancelEmergency}
      />
    </aside>
  </section>
);
