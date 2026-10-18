import { type CaosCard, canSplitCard } from "@cafeore/common";
import { ChevronDown, ChevronUp } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { dropTargetLabel } from "../hooks/useCardDrag";
import type { UnassignedPick } from "../hooks/useUnassignedPick";
import {
  type CardLooks,
  orderNoLabel,
  sharesOrder,
  unassignedRows,
} from "../logic/cards";
import type { NextAvailable } from "../logic/queue";
import { LongWaitTag, PanelHeader } from "./BoardParts";
import {
  BayPad,
  CancelEmergencyButton,
  OrderCard,
  SplitCupButtons,
} from "./OrderCard";
import { OrderCommentBadge } from "./OrderComments";
import { ScrollArea } from "./ScrollArea";
import {
  UnassignedHeading,
  UnfinishedList,
  type UnfinishedView,
  unassignedAreaBackground,
} from "./UnfinishedOrders";

// 未割当（管制盤 A の下の横帯と、管制盤 C の右の注文の列）。操作は管制盤が作る useControlPick（ドリッパーの列と共有する）。
// どちらも未割当のカードだけを、注文番号の行（logic/cards の unassignedRows）にまとめる。長く待っているカードには待ち時間の札を付ける。
// unfinished を渡すと（操作の画面）、見出しを「未割当」「未提供」のタブにし、「未提供」ではまだ提供していない注文の一覧（UnfinishedList）を出す。
// カードはなぞると掴むので、スクロールはスクロールバー（ScrollArea）か、カードの無い所をなぞる。

/**
 * 未割当の 1 枚。開くと上下に 1〜6 のボタン（入れ直しのカードは「取り消す」も）、統合できる相手には「統合する」を重ねる。
 * もう一度押すと統合する相手が決まっていれば、開いたカードにその番号を出す
 */
const UnassignedCard: React.FC<{
  card: CaosCard;
  looks: CardLooks;
  pick: UnassignedPick;
  size: "sm" | "queue" | "md";
  selected: boolean;
  nowMs: number;
  readOnly?: boolean;
  className?: string;
}> = ({
  card,
  looks,
  pick,
  size,
  selected,
  nowMs,
  readOnly = false,
  className = "",
}) => {
  const isOpen = !readOnly && pick.isOpen(card);
  const isMergeCandidate = !readOnly && pick.canMergeWith(card);
  return (
    <OrderCard
      card={card}
      look={looks.get(card.key)}
      size={size}
      selected={selected}
      mergeInto={isOpen ? pick.partner : undefined}
      mergeTap={isMergeCandidate}
      data-unassigned-uid={card.key}
      data-search-key={card.key}
      onPointerDown={
        readOnly || isMergeCandidate
          ? undefined
          : (event) => pick.drag.press(card, event)
      }
      onClickCapture={pick.drag.suppressClick}
      onClick={readOnly ? undefined : () => pick.tap(card)}
      className={`${readOnly ? "touch-manipulation" : "cursor-grab touch-none active:cursor-grabbing"} ${isOpen ? "z-40" : ""} ${className}`}
      dragging={pick.drag.source?.key === card.key}
    >
      <LongWaitTag card={card} nowMs={nowMs} />
      {isOpen && (
        <BayPad
          card={card}
          hoveredBay={pick.drag.target?.bayId ?? null}
          onPick={(bayId) => pick.assign(card, bayId)}
        />
      )}
      {isOpen && pick.split && canSplitCard(card) && (
        <SplitCupButtons
          card={card}
          onSplit={(cupId) => pick.split?.(card, cupId)}
        />
      )}
      {isOpen && card.emergency && pick.cancelEmergency && (
        <CancelEmergencyButton onConfirm={() => pick.cancelEmergency?.(card)} />
      )}
    </OrderCard>
  );
};

/** 運んでいるカードの写し（指に付いて動く） */
const DragGhost: React.FC<{
  pick: UnassignedPick;
  looks: CardLooks;
  size: "sm" | "queue" | "md";
}> = ({ pick, looks, size }) =>
  pick.drag.source &&
  pick.drag.ghost(
    <OrderCard
      card={pick.drag.source}
      look={looks.get(pick.drag.source.key)}
      size={size}
    />,
    dropTargetLabel(pick.drag.target),
  );

const EmptyNote: React.FC = () => (
  <div className="w-full rounded-md border border-dashed py-8 text-center text-slate-400 text-xs">
    レジからのオーダーを待っています
  </div>
);

type UnassignedProps = {
  orders: CaosCard[];
  looks: CardLooks;
  selectedOrderId: string | null;
  /** 今（エポックのミリ秒。長く待っているカードの札） */
  nowMs: number;
  /** カードの操作（useControlPick） */
  pick: UnassignedPick;
  /** 閲覧だけの画面。カードを押しても開かず、動かさない */
  readOnly?: boolean;
  /** 「未提供」のタブ（操作の画面だけ） */
  unfinished?: UnfinishedView;
  nextAvailable?: NextAvailable;
};

/** 未割当の横帯をたたむか（閲覧だけの画面。たたむと見出しの行だけにする） */
export interface UnassignedFold {
  folded: boolean;
  toggle: () => void;
}

/**
 * 管制盤 A の下の横帯。C の注文の列（unassignedRows）を倒した形で、注文ごとに 1 列（上に番号、その下に同じ注文のカードを縦に）を
 * 左端から古い順に並べる。同じ注文のカードは右へ折り返さず、すべて同じ番号の下へ縦に積む。
 * 注文のまとまりは、列（上の番号）と余白で見せる。全件を見る横スクロールバーはヘッダーの「未割当」の右に置く。
 * fold を渡すと、ヘッダーの右に「たたむ」「ひらく」を出し、たたんだらヘッダーだけにする。
 */
export const UnassignedStrip: React.FC<
  UnassignedProps & { nextAvailable: NextAvailable; fold?: UnassignedFold }
> = ({
  nextAvailable,
  readOnly = false,
  orders,
  looks,
  selectedOrderId,
  nowMs,
  pick,
  fold,
  unfinished,
}) => {
  const columns = unassignedRows(orders);
  const folded = fold?.folded ?? false;
  // 横のスクロールバーを置く、見出しの行の空いた所（件数と右側の操作の間。重ならず、件数や時刻の幅が変わってもそこに収まる）
  const [trackSlot, setTrackSlot] = useState<HTMLDivElement | null>(null);
  const Chevron = folded ? ChevronUp : ChevronDown;
  return (
    <section
      className={`flex flex-col overflow-hidden rounded-lg border border-slate-300 ${unassignedAreaBackground(unfinished)} shadow-xs ${folded ? "" : "h-full"}`}
    >
      <header
        className={`flex ${unfinished ? "h-14" : "h-10"} shrink-0 items-center gap-2 border-slate-300 border-b bg-slate-100 px-2`}
      >
        <UnassignedHeading
          view={unfinished}
          nextBayId={nextAvailable?.[0]?.bayId}
          unassignedOrders={orders}
          className="text-[18px]"
        />
        <div ref={setTrackSlot} className="h-5 min-w-12 flex-1" />
        {fold && (
          <button
            type="button"
            aria-expanded={!folded}
            onClick={fold.toggle}
            className="flex h-8 shrink-0 touch-manipulation items-center gap-1 rounded-md border border-slate-300 bg-white px-2 font-bold text-[13px] text-slate-700 hover:bg-slate-100"
          >
            <Chevron className="h-4 w-4" />
            {folded ? "ひらく" : "たたむ"}
          </button>
        )}
      </header>
      {unfinished?.tab === "unfinished" && (
        <UnfinishedList view={unfinished} axis="x" trackSlot={trackSlot} />
      )}
      {!folded && unfinished?.tab !== "unfinished" && (
        <ScrollArea
          axis="x"
          trackSlot={trackSlot}
          className="flex-1"
          scrollerClassName="overscroll-x-contain"
        >
          {/* 注文の間は広く、注文の中は狭く空ける（まとまりは色でなく並びと余白で見せる）。 */}
          <div className="flex min-h-full w-max min-w-full items-start gap-5 px-2 pt-1.5 pb-[40px]">
            {columns.map(({ orderNo, emergency, cards }) => (
              <div
                key={`${emergency}:${orderNo}`}
                className="flex shrink-0 flex-col gap-0.5"
              >
                <div className="flex h-[32px] items-center justify-center gap-1.5 font-black font-mono text-[24px] text-slate-800 leading-none">
                  <span className="flex items-center gap-1">
                    {orderNoLabel(orderNo)}
                    <OrderCommentBadge
                      cards={cards}
                      looks={looks}
                      orderNo={orderNo}
                    />
                  </span>
                  {emergency && (
                    <span className="font-sans text-[12px] text-red-600">
                      緊急
                    </span>
                  )}
                </div>
                {/* 切り取らない（選択中の黄の輪・開いたカードの 1〜6 のボタン・待ち時間の札はカードの外へ出る） */}
                <div className="flex w-[180px] flex-col gap-1.5 whitespace-nowrap">
                  {cards.map((card) => (
                    <UnassignedCard
                      key={card.key}
                      card={card}
                      looks={looks}
                      pick={pick}
                      size="queue"
                      selected={sharesOrder(card, selectedOrderId)}
                      nowMs={nowMs}
                      readOnly={readOnly}
                      className="min-h-[62px]"
                    />
                  ))}
                </div>
              </div>
            ))}
            {columns.length === 0 && <EmptyNote />}
          </div>
        </ScrollArea>
      )}
      {!readOnly && <DragGhost pick={pick} looks={looks} size="queue" />}
    </section>
  );
};

/** 管制盤 C の右の注文の列。未割当のカードを注文番号の行ごとに並べる（logic/cards の unassignedRows）。10 注文くらいが一度に見える高さ */
export const OrderQueuePanel: React.FC<UnassignedProps> = ({
  orders,
  looks,
  selectedOrderId,
  nowMs,
  pick,
  unfinished,
  readOnly = false,
  nextAvailable,
}) => {
  const rows = unassignedRows(orders);
  return (
    <section
      className={`flex h-full flex-col overflow-hidden rounded-lg border border-slate-300 shadow-xs ${unassignedAreaBackground(unfinished)}`}
    >
      <PanelHeader
        heightClassName={unfinished ? "h-14" : undefined}
        backgroundClassName="bg-slate-100"
        className="border-slate-300 border-b"
      >
        <UnassignedHeading
          view={unfinished}
          nextBayId={nextAvailable?.[0]?.bayId}
          unassignedOrders={orders}
        />
      </PanelHeader>
      {unfinished?.tab === "unfinished" ? (
        <UnfinishedList view={unfinished} axis="y" />
      ) : (
        <ScrollArea
          axis="y"
          className="flex-1"
          scrollerClassName="divide-y divide-slate-200 overscroll-contain px-2 pt-1 pb-8"
        >
          {rows.map(({ orderNo, emergency, cards }) => (
            <div
              key={`${emergency}:${orderNo}`}
              className="flex min-h-[62px] items-stretch gap-1.5 py-1.5"
            >
              <span className="flex w-20 shrink-0 flex-col items-center justify-center font-black font-mono text-[17px] text-slate-700 leading-none">
                <span className="flex items-center gap-1">
                  {orderNoLabel(orderNo)}
                  <OrderCommentBadge
                    cards={cards}
                    looks={looks}
                    orderNo={orderNo}
                  />
                </span>
                {emergency && (
                  <span className="mt-1 font-sans text-[11px] text-red-600">
                    緊急
                  </span>
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                {cards.map((card) => (
                  <UnassignedCard
                    key={card.key}
                    card={card}
                    looks={looks}
                    pick={pick}
                    readOnly={readOnly}
                    size="sm"
                    selected={sharesOrder(card, selectedOrderId)}
                    nowMs={nowMs}
                    className="min-h-[60px] w-[150px]"
                  />
                ))}
              </div>
            </div>
          ))}
          {rows.length === 0 && <EmptyNote />}
        </ScrollArea>
      )}
      {!readOnly && <DragGhost pick={pick} looks={looks} size="sm" />}
    </section>
  );
};
