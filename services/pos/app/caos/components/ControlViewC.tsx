import type { CaosCard } from "@cafeore/common";
import type React from "react";
import { useState } from "react";
import { dropSideOn, useCardHold } from "../hooks/useCardDrag";
import type { CardMenu } from "../hooks/useCardMenu";
import {
  type UnassignedPick,
  useControlPick,
} from "../hooks/useUnassignedPick";
import { type CardLook, orderLabel, sharesOrder } from "../logic/cards";
import { type Lane, laneActive, pendingNominatedCups } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
import { DripperIndicator, EmptySlotButton } from "./BoardParts";
import { CardOverlay } from "./CardActions";
import type { ControlViewProps } from "./ControlWorkspace";
import { LaneAbility, LaneChangeButton } from "./LaneParts";
import { OrderCard } from "./OrderCard";
import { OrderQueuePanel } from "./UnassignedOrdersPanel";

const COLUMNS = ["ドリップ中", "待ち1", "待ち2", "待ち3"];

// 管制盤 C：左にドリッパーの行、右に注文の列（未割当のカードを注文番号の順に）。
// 各行は「ドリップ中」「待ち1」「待ち2」「待ち3」の固定4列。待ち4以降は待ち3の列内で縦にスクロールする。
// ドリッパーの列のカードは注文番号を大きく出す（OrderCard の lane）。
// カードを押すと、その段階の操作のアイコンをカードの上に出す（cardMenu。CardOverlay）。長押しで待機は詳細（移動・先頭へ・待機の先頭へ・未割当に戻す・統合の解除）、
// 抽出中は緊急のパネル（1〜6 に移す・未割当に戻すも）（onHoldCard）。ドリッパーの列のカードはドラッグしない（横になぞると待機の列のスクロール）ので、長押しだけ。
// 右の未割当のカードを開いているあいだは、統合できる待機・抽出中のカードに「統合する」が出て、押すとそのカードに統合する（pick。右の注文の列と共有。詳細は開かない）。
// 未割当のカードを待機・抽出中のカードの上に落とすと、左の端はそのカードの前・右の端は後ろ・真ん中は統合（統合できる相手のときだけ）
// （抽出中のカードの前は列の先頭で今から始まり、後ろは待機の先頭。useCardDrag の dropTargetAt）。指の下のカードには入れる所の線か統合の枠（DropMark）
export const ControlViewC: React.FC<ControlViewProps> = (props) => {
  const pick = useControlPick(props);
  const hold = useCardHold<CaosCard>(props.onHoldCard);
  const [queueTab, setQueueTab] = useState<"unassigned" | "unfinished" | "all">(
    props.unfinished?.tab ?? "unassigned",
  );
  return (
    <ControlViewCBoard
      {...props}
      pick={pick}
      hold={hold}
      queueTab={queueTab}
      onSelectQueueTab={setQueueTab}
    />
  );
};

const ControlViewCBoard: React.FC<
  ControlViewProps & {
    pick: UnassignedPick;
    hold: CardHold;
    queueTab: "unassigned" | "unfinished" | "all";
    onSelectQueueTab: (tab: "unassigned" | "unfinished" | "all") => void;
  }
> = ({
  lanes,
  unassignedOrders,
  orders,
  looks,
  nextAvailable,
  nowMs,
  selectedOrderId,
  cardMenu,
  onOpenEmptySlot,
  onOpenLane,
  unfinished,
  commentsPanel,
  pick,
  hold,
  queueTab,
  onSelectQueueTab,
  readOnly = false,
  flashKeys,
}) => (
  <section
    className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_560px] gap-2"
    aria-label="Cコントロール画面"
  >
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
      <div className="min-h-0 flex-1 overflow-x-auto">
        <div className="flex h-full min-w-[720px] flex-col">
          <header className="flex h-11 shrink-0 items-center gap-2 border-slate-200 border-b bg-slate-100 px-2">
            <h2 className="w-[46px] shrink-0 text-center font-black text-[11px] text-slate-700">
              担当
            </h2>
            <div className="grid min-w-0 flex-1 grid-cols-4 gap-1.5">
              {COLUMNS.map((label, index) => (
                <span
                  key={label}
                  className={`rounded-md py-1.5 text-center font-black text-[14px] ${index === 0 ? "bg-emerald-100 text-emerald-900" : "bg-slate-200 text-slate-700"}`}
                >
                  {label}
                </span>
              ))}
            </div>
          </header>
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
                  className={`relative isolate flex min-h-0 items-stretch gap-2 px-2 py-1 ${isLinked ? "bg-amber-50 ring-2 ring-amber-400 ring-inset" : "bg-white"}`}
                >
                  <DripperIndicator
                    bayId={bay.id}
                    status={lane}
                    nominatedCups={pendingNominatedCups(
                      unassignedOrders,
                      bay.id,
                    )}
                    onOpenLane={readOnly ? undefined : onOpenLane}
                    className="w-[46px]"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <LaneChangeButton
                        dripper={bay.id}
                        className="font-black text-[20px] text-slate-950"
                      />
                      <LaneAbility dripper={bay.id} />
                    </div>
                    <div className="grid min-h-0 flex-1 grid-cols-4 gap-1.5">
                      {COLUMNS.map((label, index) => {
                        const cards =
                          index === 0
                            ? current
                              ? [current]
                              : []
                            : index === 3
                              ? lane.waiting.slice(2)
                              : lane.waiting.slice(index - 1, index);
                        return (
                          <section
                            key={label}
                            aria-label={`${bay.id} ${label}`}
                            className={`flex min-h-0 min-w-0 flex-col rounded-lg border ${index === 0 ? "border-emerald-300 bg-emerald-50" : "border-slate-200 bg-slate-50"}`}
                          >
                            <div
                              className={`flex min-h-0 flex-1 flex-col gap-2 p-0.5 ${index === 3 && cards.length > 1 ? "overflow-y-auto" : ""}`}
                            >
                              {cards.map((ticket, position) => (
                                <div
                                  key={ticket.key}
                                  className="flex min-h-[48px] shrink-0 flex-col"
                                >
                                  {position > 0 && (
                                    <span className="text-center font-bold text-[11px] text-slate-600">
                                      待ち{position + 3}
                                    </span>
                                  )}
                                  <LaneCard
                                    readOnly={readOnly}
                                    flash={flashKeys?.has(ticket.key)}
                                    card={ticket}
                                    look={looks.get(ticket.key)}
                                    selected={sharesOrder(
                                      ticket,
                                      selectedOrderId,
                                    )}
                                    lane={bay}
                                    nowMs={nowMs}
                                    pick={pick}
                                    hold={hold}
                                    menu={cardMenu}
                                    className={`min-h-[48px] flex-1 ${readOnly ? "" : "cursor-pointer hover:ring-2 hover:ring-blue-400"}`}
                                  />
                                </div>
                              ))}
                              {cards.length === 0 &&
                                (!readOnly && index > 0 ? (
                                  <EmptySlotButton
                                    onClick={() => onOpenEmptySlot(bay.id)}
                                    className="min-h-[48px] flex-1"
                                  />
                                ) : (
                                  <span className="min-h-[48px] flex-1 rounded border border-slate-300 border-dashed" />
                                ))}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>

    <aside className="min-h-0 min-w-0">
      {commentsPanel ?? (
        <OrderQueuePanel
          readOnly={readOnly}
          nextAvailable={nextAvailable}
          orders={unassignedOrders}
          looks={looks}
          nowMs={nowMs}
          selectedOrderId={selectedOrderId}
          pick={pick}
          unfinished={unfinished}
          allOrders={
            !readOnly && unfinished && orders
              ? {
                  orders,
                  active: queueTab === "all",
                  onSelect: () => onSelectQueueTab("all"),
                  onSelectBase: (tab) => {
                    onSelectQueueTab(tab);
                    unfinished.onSelectTab(tab);
                  },
                }
              : undefined
          }
        />
      )}
    </aside>
  </section>
);

type CardHold = ReturnType<typeof useCardHold<CaosCard>>;

// ドリッパーの列のカード（抽出中・待機）。開いた未割当のカードと統合できれば押して統合し、ほかは操作のアイコンを開く（menu）。
// 長押しは hold（待機の詳細・抽出中の淹れ直し）。ドラッグで落とす先の目印（前・後ろ・統合。useCardDrag の dropTargetAt）を持ち、
// 指の下なら入れる所の線か統合の枠を出す
const LaneCard: React.FC<{
  card: CaosCard;
  look?: CardLook;
  selected: boolean;
  lane: Lane;
  nowMs: number;
  pick: UnassignedPick;
  hold: CardHold;
  menu?: CardMenu;
  className: string;
  readOnly?: boolean;
  flash?: boolean;
}> = ({
  card,
  look,
  selected,
  lane,
  nowMs,
  pick,
  hold,
  menu,
  className,
  readOnly = false,
  flash = false,
}) => {
  const mergeTap = !readOnly && pick.canMergeWith(card);
  return (
    <OrderCard
      card={card}
      look={look}
      size="lane"
      parallelOrderNumbers
      selected={selected}
      data-queued-ticket={card.key}
      data-search-key={card.key}
      data-ticket-label={orderLabel(card)}
      mergeTap={mergeTap}
      dropSide={dropSideOn(pick.drag.target, card.key)}
      onPointerDown={readOnly ? undefined : (event) => hold.press(card, event)}
      onClickCapture={readOnly ? undefined : hold.suppressClick}
      onClick={
        readOnly
          ? undefined
          : () => (mergeTap ? pick.tap(card) : menu?.toggle(card))
      }
      className={`${className} ${flash ? "caos-arrival" : ""}`}
    >
      <CardOverlay
        card={card}
        lane={lane}
        look={look}
        nowMs={nowMs}
        menu={readOnly ? undefined : menu}
      />
    </OrderCard>
  );
};
