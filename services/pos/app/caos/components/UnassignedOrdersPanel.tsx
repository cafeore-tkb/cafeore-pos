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
  orderNoLabel,
  orderRows,
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
  OrderCard,
  SplitCupButtons,
} from "./OrderCard";

// 未割当（管制盤 A の下の横帯と、管制盤 C の右の注文の列）。操作は useUnassignedPick。
// どちらも注文番号の順に注文ごとにまとめ、ほかの注文と統合したカードはもとの注文の場所に跡（MergedTrace）を残す。

// スクロールする列のカードは、スクロールの向きの指の動きをスクロールに任せる（useCardDrag の press の scroll）
const TOUCH = { x: "touch-pan-x", y: "touch-pan-y" } as const;

/** 未割当の 1 枚。開くと上下に 1〜6 のボタン（入れ直しのカードは「取り消す」も）、統合できる相手には「統合する」を重ねる */
const UnassignedCard: React.FC<{
  card: CaosCard;
  looks: CardLooks;
  pick: UnassignedPick;
  size: "sm" | "lg";
  selected: boolean;
  /** 置いた枠のスクロールの向き（無ければ枠はスクロールしない） */
  scroll?: "x" | "y";
  readOnly?: boolean;
  className?: string;
}> = ({
  card,
  looks,
  pick,
  size,
  selected,
  scroll,
  readOnly = false,
  className = "",
}) => {
  const isOpen = pick.isOpen(card);
  const isMergeCandidate = pick.canMergeWith(card);
  const touch = scroll && !isOpen ? TOUCH[scroll] : "touch-none";
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
          : (event) => pick.drag.press(card, event, isOpen ? undefined : scroll)
      }
      onClickCapture={pick.drag.suppressClick}
      onClick={readOnly ? undefined : () => pick.tap(card)}
      className={`${readOnly ? "touch-manipulation" : `cursor-grab active:cursor-grabbing ${touch}`} ${isOpen ? "z-40" : ""} ${className}`}
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
  size: "sm" | "lg";
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

// 横帯の 1 段の列の数
const STRIP_COLUMNS = 6;

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

/**
 * 管制盤 A の下の横帯（1 段 6 列。2 段が見える高さで、先の注文は縦のスクロールで見る）。注文ごとにまとめ（注文は段をまたがせない）、
 * 2 枚以上の注文は同じ注文の色の枠で囲む（同じ注文がほかにもあるときだけ囲う）。
 * 見出しはスクロールしても上に残し、スクロールは段ごとに止める。開いたカードの 1〜6 のボタンは、上の段は見出しの上に重ね、
 * 下の段は 2 段の下の余り（と最後の余白）に出す
 */
export const UnassignedStrip: React.FC<
  UnassignedProps & { nextAvailable: NextAvailable }
> = ({ nextAvailable, readOnly = false, ...props }) => {
  const { orders, looks, selectedOrderId } = props;
  const pick = useUnassignedPick({
    ...props,
    placed: props.lanes?.flatMap(laneActive),
  });
  return (
    <section className="h-full snap-y snap-mandatory scroll-pt-11 overflow-y-auto overscroll-contain rounded-lg border border-slate-300 bg-white shadow-xs">
      <PanelHeader
        icon={ClipboardList}
        title="未割当"
        className="sticky top-0 z-30 border-slate-200 border-b"
      >
        <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-bold font-mono text-[11px] text-red-600">
          {orders.length} 件 / {totalCups(orders)} 杯
        </span>
        <NextAvailableChips nextAvailable={nextAvailable} />
      </PanelHeader>
      <div className="flex flex-wrap content-start p-1 pb-10">
        {orderRows(orders).map(({ orderNo, emergency, entries }) => (
          <div
            key={`${emergency}:${orderNo}`}
            className="flex h-[66px] snap-start p-0.5"
            style={{
              width: `${(Math.min(entries.length, STRIP_COLUMNS) / STRIP_COLUMNS) * 100}%`,
            }}
          >
            <div
              className={`flex min-w-0 flex-1 gap-1 ${entries.length > 1 ? "rounded-xl border-(color:--caos-same-order) border-2 bg-(color:--caos-same-order-soft) p-0.5" : ""}`}
            >
              {entries.map((entry) => (
                <StripEntry
                  key={entry.card.key}
                  orderNo={orderNo}
                  entry={entry}
                  pick={pick}
                  looks={looks}
                  selectedOrderId={selectedOrderId}
                  readOnly={readOnly}
                />
              ))}
            </div>
          </div>
        ))}
        {orders.length === 0 && <EmptyNote />}
      </div>
      <DragGhost pick={pick} looks={looks} size="lg" />
    </section>
  );
};

const StripEntry: React.FC<{
  orderNo: number;
  entry: OrderRowEntry;
  pick: UnassignedPick;
  looks: CardLooks;
  selectedOrderId: string | null;
  readOnly: boolean;
}> = ({ orderNo, entry, pick, looks, selectedOrderId, readOnly }) =>
  entry.mergedInto ? (
    <MergedTrace orderNo={orderNo} into={entry.mergedInto} className="flex-1" />
  ) : (
    <UnassignedCard
      card={entry.card}
      looks={looks}
      pick={pick}
      size="lg"
      selected={sharesOrder(entry.card, selectedOrderId)}
      scroll="y"
      readOnly={readOnly}
      className="flex-1"
    />
  );

// 注文の列で、ドリッパーに置いたカードの薄さ（未割当は濃く、待機・抽出中・済の順に薄く、灰色にする）
const PLACED_FADE: Record<CaosCard["status"], string> = {
  unassigned: "",
  queued: "opacity-70 grayscale",
  brewing: "opacity-50 grayscale",
  done: "opacity-30 grayscale",
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
  const rows = queueRows([...orders, ...lanes.flatMap(laneCards)]);
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-xs">
      <PanelHeader icon={ClipboardList} title="注文">
        <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-bold font-mono text-[11px] text-red-600">
          未割当 {orders.length} 件 / {totalCups(orders)} 杯
        </span>
      </PanelHeader>
      <div className="min-h-0 flex-1 divide-y divide-slate-200 overflow-y-auto overscroll-contain px-2 pt-1 pb-8">
        {rows.map(({ orderNo, emergency, entries }) => (
          <div
            key={`${emergency}:${orderNo}`}
            className="flex min-h-[62px] items-stretch gap-1.5 py-1.5"
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
              {entries.map(({ card, mergedInto }) => {
                const selected = sharesOrder(card, selectedOrderId);
                if (mergedInto)
                  return (
                    <MergedTrace
                      key={card.key}
                      orderNo={orderNo}
                      into={mergedInto}
                      className="h-[50px] w-[150px]"
                    />
                  );
                if (card.status === "unassigned")
                  return (
                    <UnassignedCard
                      key={card.key}
                      card={card}
                      looks={looks}
                      pick={pick}
                      size="sm"
                      selected={selected}
                      scroll="y"
                      className="h-[50px] w-[150px]"
                    />
                  );
                return (
                  <div key={card.key} className="relative h-[50px] w-[150px]">
                    <OrderCard
                      card={card}
                      look={looks.get(card.key)}
                      size="sm"
                      selected={selected}
                      className={`h-full ${PLACED_FADE[card.status]}`}
                    />
                    <PlaceTag label={places.get(card.key)} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        {rows.length === 0 && <EmptyNote />}
      </div>
      <DragGhost pick={pick} looks={looks} size="sm" />
    </section>
  );
};
