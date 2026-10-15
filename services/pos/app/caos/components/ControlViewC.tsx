import { CircleDot } from "lucide-react";
import type React from "react";
import {
  type UnassignedPick,
  useControlPick,
} from "../hooks/useUnassignedPick";
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
import { MergeOverlay, OrderCard } from "./OrderCard";
import { OrderQueuePanel } from "./UnassignedOrdersPanel";

// 管制盤 C：左にドリッパーの行、右に注文の列（未割当のカードを注文番号の順に）。
// 行は時系列の順に、ドリッパーの番号（列の状態）・抽出中・「次へ」・待機。
// ドリッパーの列のカードは注文番号を大きく出す（OrderCard の lane）。
// 待機のカードはタップで詳細（移動・先頭へ・未割当に戻す・統合の解除）、抽出中のカードはタップで緊急のパネル（1〜6 に移す・未割当に戻すも）。
// 右の未割当のカードを開いているあいだは、統合できる抽出中のカードに「統合する」が出て、押すとそのカードに統合する（pick。右の注文の列と共有）。
// 未割当のカードを待機・抽出中のカードの上に落とすと、そのカードの前へ（抽出中のカードの前は列の先頭で、今から始まる。
// 統合できる待機のカードの上の右の部分・統合できる抽出中のカードの上なら統合）
export const ControlViewC: React.FC<ControlViewProps> = (props) => {
  const pick = useControlPick(props);
  return <ControlViewCBoard {...props} pick={pick} />;
};

const ControlViewCBoard: React.FC<
  ControlViewProps & { pick: UnassignedPick }
> = ({
  lanes,
  unassignedOrders,
  looks,
  nextAvailable,
  nowMs,
  selectedOrderId,
  onAdvanceBay,
  onOpenTicket,
  onOpenRebrew,
  onOpenEmptySlot,
  onOpenLane,
  pick,
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
              className={`relative isolate flex min-h-0 items-stretch gap-2 p-2 ${isLinked ? "bg-amber-50 ring-2 ring-amber-400 ring-inset" : "bg-white"}`}
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
                      size="lane"
                      selected={sharesOrder(current, selectedOrderId)}
                      data-merge-target={current.key}
                      data-queued-ticket={current.key}
                      data-search-key={current.key}
                      data-ticket-label={orderLabel(current)}
                      data-merge-tap={pick.canMergeWith(current) || undefined}
                      // 抽出中が無い列の先頭（「次へ」で始める）は、まだ待機のカード。抽出中のカードは入れ直し（開いた未割当のカードと統合できれば統合）
                      onClick={() => {
                        if (pick.canMergeWith(current)) pick.tap(current);
                        else if (current.status === "queued")
                          onOpenTicket(current);
                        else onOpenRebrew?.(current);
                      }}
                      className={
                        current.status === "queued"
                          ? "cursor-pointer hover:ring-2 hover:ring-blue-400"
                          : ""
                      }
                    >
                      {pick.canMergeWith(current) && <MergeOverlay />}
                    </OrderCard>
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

                  {/* 選択中の黄の輪（外へ 6px）と統合したカードの重ねた枠（8px）が切れないよう、外へ広げて内に同じだけ空ける（行の余白も 8px） */}
                  <div className="-m-2 flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {lane.waiting.map((ticket) => (
                      <OrderCard
                        key={ticket.key}
                        card={ticket}
                        look={looks.get(ticket.key)}
                        size="lane"
                        selected={sharesOrder(ticket, selectedOrderId)}
                        data-queued-ticket={ticket.key}
                        data-merge-target={ticket.key}
                        data-search-key={ticket.key}
                        data-ticket-label={orderLabel(ticket)}
                        onClick={() => onOpenTicket(ticket)}
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
        looks={looks}
        nowMs={nowMs}
        selectedOrderId={selectedOrderId}
        pick={pick}
      />
    </aside>
  </section>
);
