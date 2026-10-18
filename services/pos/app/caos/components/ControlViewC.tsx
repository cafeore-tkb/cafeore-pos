import type { CaosCard } from "@cafeore/common";
import { CircleDot } from "lucide-react";
import type React from "react";
import { dropSideOn, useCardHold } from "../hooks/useCardDrag";
import type { CardMenu } from "../hooks/useCardMenu";
import {
  type UnassignedPick,
  useControlPick,
} from "../hooks/useUnassignedPick";
import { type CardLook, orderLabel, sharesOrder } from "../logic/cards";
import { type Lane, laneActive, pendingNominatedCups } from "../logic/lanes";
import { laneStatus } from "../logic/queue";
import { DripperIndicator, EmptySlotButton, PanelHeader } from "./BoardParts";
import { CardOverlay } from "./CardActions";
import type { ControlViewProps } from "./ControlWorkspace";
import { LaneAbility, LaneChangeButton } from "./LaneParts";
import { OrderCard } from "./OrderCard";
import { OrderQueuePanel } from "./UnassignedOrdersPanel";

// 管制盤 C：左にドリッパーの行、右に注文の列（未割当のカードを注文番号の順に）。
// 行は時系列の順に、ドリッパーの番号（列の状態）・抽出中・待機。
// ドリッパーの列のカードは注文番号を大きく出す（OrderCard の lane）。
// カードを押すと、その段階の操作のアイコンをカードの上に出す（cardMenu。CardOverlay）。長押しで待機は詳細（移動・先頭へ・待機の先頭へ・未割当に戻す・統合の解除）、
// 抽出中は緊急のパネル（1〜6 に移す・未割当に戻すも）（onHoldCard）。ドリッパーの列のカードはドラッグしない（横になぞると待機の列のスクロール）ので、長押しだけ。
// 右の未割当のカードを開いているあいだは、統合できる待機・抽出中のカードに「統合する」が出て、押すとそのカードに統合する（pick。右の注文の列と共有。詳細は開かない）。
// 未割当のカードを待機・抽出中のカードの上に落とすと、左の端はそのカードの前・右の端は後ろ・真ん中は統合（統合できる相手のときだけ）
// （抽出中のカードの前は列の先頭で今から始まり、後ろは待機の先頭。useCardDrag の dropTargetAt）。指の下のカードには入れる所の線か統合の枠（DropMark）
export const ControlViewC: React.FC<ControlViewProps> = (props) => {
  const pick = useControlPick(props);
  const hold = useCardHold<CaosCard>(props.onHoldCard);
  return <ControlViewCBoard {...props} pick={pick} hold={hold} />;
};

const ControlViewCBoard: React.FC<
  ControlViewProps & { pick: UnassignedPick; hold: CardHold }
> = ({
  lanes,
  unassignedOrders,
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
  readOnly = false,
  flashKeys,
}) => (
  <section
    className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_524px] gap-2"
    aria-label="Cコントロール画面"
  >
    <section className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
      <PanelHeader icon={CircleDot} title="ドリッパー" />

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
                <div className="grid min-h-0 flex-1 grid-cols-[156px_minmax(0,1fr)] items-stretch gap-1.5">
                  {current ? (
                    <LaneCard
                      readOnly={readOnly}
                      flash={flashKeys?.has(current.key)}
                      card={current}
                      look={looks.get(current.key)}
                      selected={sharesOrder(current, selectedOrderId)}
                      lane={bay}
                      nowMs={nowMs}
                      pick={pick}
                      hold={hold}
                      menu={cardMenu}
                      className={
                        readOnly
                          ? ""
                          : "cursor-pointer hover:ring-2 hover:ring-blue-400"
                      }
                    />
                  ) : (
                    <span className="rounded-lg border border-slate-300 border-dashed" />
                  )}

                  {/* 選択中の黄の輪（外へ 6px）と統合したカードの重ねた枠（8px）が切れないよう、外へ広げて内に同じだけ空ける（行の余白も 8px） */}
                  <div className="-m-2 flex min-w-0 gap-1 overflow-x-auto overflow-y-hidden p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {lane.waiting.map((ticket) => (
                      <LaneCard
                        key={ticket.key}
                        readOnly={readOnly}
                        flash={flashKeys?.has(ticket.key)}
                        card={ticket}
                        look={looks.get(ticket.key)}
                        selected={sharesOrder(ticket, selectedOrderId)}
                        lane={bay}
                        nowMs={nowMs}
                        pick={pick}
                        hold={hold}
                        menu={cardMenu}
                        className={`w-[150px] shrink-0 ${readOnly ? "" : "cursor-pointer hover:ring-2 hover:ring-blue-400"}`}
                      />
                    ))}
                    {!readOnly && lane.waiting.length === 0 && (
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
        />
      )}
    </aside>
  </section>
);

type CardHold = ReturnType<typeof useCardHold<CaosCard>>;

// ドリッパーの列のカード（抽出中・待機）。開いた未割当のカードと統合できれば押して統合し、ほかは操作のアイコンを開く（menu）。
// 長押しは hold（待機の詳細・抽出中の入れ直し）。ドラッグで落とす先の目印（前・後ろ・統合。useCardDrag の dropTargetAt）を持ち、
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
