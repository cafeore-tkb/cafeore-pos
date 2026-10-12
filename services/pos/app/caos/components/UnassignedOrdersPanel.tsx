import { type CaosCard, type CaosPlace, canSplitCard } from "@cafeore/common";
import { ClipboardList } from "lucide-react";
import type React from "react";
import { dropTargetLabel } from "../hooks/useCardDrag";
import {
  type UnassignedPick,
  useUnassignedPick,
} from "../hooks/useUnassignedPick";
import {
  type CardLooks,
  type OrderRowEntry,
  orderFrames,
  orderNoLabel,
  queueRows,
  sharesOrder,
  totalCups,
} from "../logic/cards";
import { type Lane, cardPlaces, laneActive, laneCards } from "../logic/lanes";
import type { NextAvailable } from "../logic/queue";
import { NextAvailableChips, PanelHeader, PlaceTag } from "./BoardParts";
import {
  BayPad,
  CancelEmergencyButton,
  MergeOverlay,
  MergedTrace,
  ORDER_FRAME,
  OrderCard,
  SplitCupButtons,
} from "./OrderCard";
import { ScrollArea } from "./ScrollArea";

// 未割当（管制盤 A の下の横帯と、管制盤 C の右の注文の列）。操作は useUnassignedPick。
// どちらも注文番号の順に注文ごとにまとめ、ほかの注文と統合したカードはもとの注文の場所に跡（MergedTrace）を残す。
// カードはなぞると掴むので、スクロールはスクロールバー（ScrollArea）か、カードの無い所をなぞる。

/** 未割当の 1 枚。開くと上下に 1〜6 のボタン（入れ直しのカードは「取り消す」も）、統合できる相手には「統合する」を重ねる */
const UnassignedCard: React.FC<{
  card: CaosCard;
  looks: CardLooks;
  pick: UnassignedPick;
  size: "sm" | "md";
  selected: boolean;
  readOnly?: boolean;
  className?: string;
}> = ({
  card,
  looks,
  pick,
  size,
  selected,
  readOnly = false,
  className = "",
}) => {
  const isOpen = pick.isOpen(card);
  const isMergeCandidate = pick.canMergeWith(card);
  return (
    <OrderCard
      card={card}
      look={looks.get(card.key)}
      size={size}
      selected={selected}
      data-unassigned-uid={card.key}
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
      {isMergeCandidate && <MergeOverlay />}
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
  size: "sm" | "md";
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
  onSelectOrder: (orderId: string | null) => void;
  onAssignToBay: (card: CaosCard, bayId: number, place?: CaosPlace) => void;
  /** ドリッパーの列（ドラッグで統合する相手を引く） */
  lanes?: Lane[];
  /** 1 杯のカード（firstKey）を統合できる 1 杯のカード（intoKey）に入れる */
  onMergeOrders?: (firstKey: string, intoKey: string) => void;
  /** 統合の解除（統合したカードから 1 杯を外す） */
  onSplitCup?: (card: CaosCard, cupId: string) => void;
  /** 入れ直し（緊急）のカードを開くと「取り消す」を出す（渡したときだけ） */
  onCancelEmergency?: (card: CaosCard) => void;
  /** 閲覧だけの画面。カードを押しても開かず、動かさない */
  readOnly?: boolean;
};

// 注文の列で、ドリッパーに置いたカードの薄さ（未割当は濃く、待機・抽出中・済の順に薄く、灰色にする）
const PLACED_FADE: Record<CaosCard["status"], string> = {
  unassigned: "",
  queued: "opacity-70 grayscale",
  brewing: "opacity-50 grayscale",
  done: "opacity-30 grayscale",
};

/**
 * 注文の 1 枚（A の横帯・C の注文の列で共通）。ほかの注文と統合したカードは跡、未割当のカードは操作できるカード、
 * ドリッパーに置いたカードは灰色に薄く「3rd 2番目」の札を付ける
 */
const QueueEntry: React.FC<{
  orderNo: number;
  entry: OrderRowEntry;
  pick: UnassignedPick;
  looks: CardLooks;
  /** ドリッパーに置いたカードの場所の札（logic/lanes の cardPlaces） */
  places: ReturnType<typeof cardPlaces>;
  selectedOrderId: string | null;
  size: "sm" | "md";
  readOnly?: boolean;
  className: string;
}> = ({
  orderNo,
  entry: { card, mergedInto },
  pick,
  looks,
  places,
  selectedOrderId,
  size,
  readOnly,
  className,
}) => {
  const selected = sharesOrder(card, selectedOrderId);
  if (mergedInto)
    return (
      <MergedTrace orderNo={orderNo} into={mergedInto} className={className} />
    );
  if (card.status === "unassigned")
    return (
      <UnassignedCard
        card={card}
        looks={looks}
        pick={pick}
        size={size}
        selected={selected}
        readOnly={readOnly}
        className={className}
      />
    );
  return (
    <div className={`relative ${className}`}>
      <OrderCard
        card={card}
        look={looks.get(card.key)}
        size={size}
        selected={selected}
        className={`h-full ${PLACED_FADE[card.status]}`}
      />
      <PlaceTag label={places.get(card.key)} />
    </div>
  );
};

// 横帯の注文の列の枠。未割当とドリッパーにまたがる注文は注文ごとの色（logic/cards の orderFrames）、
// 未割当の中だけで 2 枚以上の注文は同じ注文の紫で囲む
const columnFrame = (entries: number, frame?: number) => {
  if (frame !== undefined)
    return `border-transparent outline-[3px] outline-solid ${ORDER_FRAME[frame]}`;
  if (entries > 1)
    return "border-(color:--caos-same-order) bg-(color:--caos-same-order-soft)";
  return "border-transparent";
};

// C の注文の行の枠（未割当とドリッパーにまたがる注文だけ、注文ごとの色）
const rowFrame = (frame?: number) =>
  frame === undefined
    ? ""
    : `outline-[3px] outline-solid ${ORDER_FRAME[frame]}`;

/**
 * 管制盤 A の下の横帯。C の注文の列（queueRows）を倒した形で、注文ごとに 1 列（上に番号、その下に同じ注文のカードを縦に）を
 * 左から古い順に並べる。1 列に縦に 2 枚まで並べ、それより多い注文は同じ注文の枠の中で右へ折り返す（帯の高さからはみ出さない）。
 * 2 枚以上の注文は同じ注文の色の枠で囲む。スクロールは横だけ。開いたカードの 1〜6 のボタンは、上のカードは番号の上に重ね、
 * 下のカードは列の下の余白に出す
 */
export const UnassignedStrip: React.FC<
  UnassignedProps & { nextAvailable: NextAvailable }
> = ({ nextAvailable, readOnly = false, ...props }) => {
  const { orders, looks, selectedOrderId, lanes = [] } = props;
  const pick = useUnassignedPick({
    ...props,
    placed: lanes.flatMap(laneActive),
  });
  const places = cardPlaces(lanes);
  const cards = [...orders, ...lanes.flatMap(laneCards)];
  const columns = queueRows(cards);
  const frames = orderFrames(cards);
  return (
    <section className="flex h-full overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
      <header className="flex w-[120px] shrink-0 flex-col gap-1.5 border-slate-200 border-r bg-slate-50 p-2">
        <h2 className="flex items-center gap-1.5 font-black text-[15px] text-slate-950">
          <ClipboardList className="h-4 w-4 shrink-0 text-slate-700" />
          未割当
        </h2>
        <span className="w-fit rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-bold font-mono text-[11px] text-red-600">
          {orders.length} 件 / {totalCups(orders)} 杯
        </span>
        <NextAvailableChips
          nextAvailable={nextAvailable}
          className="flex-wrap"
        />
      </header>
      <ScrollArea
        axis="x"
        className="flex-1"
        scrollerClassName="overscroll-x-contain"
      >
        {/* 下の余白は、下のカードを開いたときの 1〜6 のボタン */}
        <div className="flex h-full w-max min-w-full items-start gap-1.5 px-1.5 pt-1.5 pb-[40px]">
          {columns.map(({ orderNo, emergency, entries }) => (
            <div
              key={`${emergency}:${orderNo}`}
              className={`flex shrink-0 flex-col rounded-xl border-2 p-0.5 ${columnFrame(entries.length, frames.get(orderNo))}`}
            >
              <div className="flex h-[30px] items-center justify-center gap-1.5 font-black font-mono text-[19px] text-slate-700 leading-none">
                {orderNoLabel(orderNo)}
                {emergency && (
                  <span className="font-sans text-[12px] text-red-600">
                    緊急
                  </span>
                )}
              </div>
              <div className="grid auto-cols-[180px] grid-flow-col grid-rows-[repeat(2,48px)] gap-1">
                {entries.map((entry) => (
                  <QueueEntry
                    key={entry.card.key}
                    orderNo={orderNo}
                    entry={entry}
                    pick={pick}
                    looks={looks}
                    places={places}
                    selectedOrderId={selectedOrderId}
                    size="md"
                    readOnly={readOnly}
                    className="h-full"
                  />
                ))}
              </div>
            </div>
          ))}
          {columns.length === 0 && <EmptyNote />}
        </div>
      </ScrollArea>
      <DragGhost pick={pick} looks={looks} size="md" />
    </section>
  );
};

/**
 * 管制盤 C の右の注文の列。いちばん古い未割当の注文から、注文番号の行ごとに、未割当のカードと、ドリッパーに置いたカード（灰色に薄く、
 * 「3rd 2番目」のようにどのドリッパーの何番目かの札）を並べる。その上に、直近にドリッパーに置いた注文を数件だけ残す（logic/cards の queueRows）。
 * 10 注文くらいが一度に見える高さ
 */
export const OrderQueuePanel: React.FC<
  Omit<UnassignedProps, "readOnly"> & { lanes: Lane[] }
> = ({ lanes, ...props }) => {
  const { orders, looks, selectedOrderId } = props;
  const pick = useUnassignedPick({
    ...props,
    placed: lanes.flatMap(laneActive),
  });
  const places = cardPlaces(lanes);
  const cards = [...orders, ...lanes.flatMap(laneCards)];
  const rows = queueRows(cards);
  const frames = orderFrames(cards);
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
      <PanelHeader icon={ClipboardList} title="注文">
        <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-bold font-mono text-[11px] text-red-600">
          未割当 {orders.length} 件 / {totalCups(orders)} 杯
        </span>
      </PanelHeader>
      <ScrollArea
        axis="y"
        className="flex-1"
        scrollerClassName="divide-y divide-slate-200 overscroll-contain px-2 pt-1 pb-8"
      >
        {rows.map(({ orderNo, emergency, entries }) => (
          <div
            key={`${emergency}:${orderNo}`}
            className={`flex min-h-[62px] items-stretch gap-1.5 rounded-lg py-1.5 ${rowFrame(frames.get(orderNo))}`}
          >
            <span className="flex w-11 shrink-0 flex-col items-center justify-center font-black font-mono text-[17px] text-slate-700 leading-none">
              {orderNoLabel(orderNo)}
              {emergency && (
                <span className="mt-1 font-sans text-[11px] text-red-600">
                  緊急
                </span>
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
              {entries.map((entry) => (
                <QueueEntry
                  key={entry.card.key}
                  orderNo={orderNo}
                  entry={entry}
                  pick={pick}
                  looks={looks}
                  places={places}
                  selectedOrderId={selectedOrderId}
                  size="sm"
                  className="h-[50px] w-[150px]"
                />
              ))}
            </div>
          </div>
        ))}
        {rows.length === 0 && <EmptyNote />}
      </ScrollArea>
      <DragGhost pick={pick} looks={looks} size="sm" />
    </section>
  );
};
