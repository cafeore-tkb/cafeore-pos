import { type CaosCard, type CaosPlace, canMergeCards } from "@cafeore/common";
import { ClipboardList, Sparkles } from "lucide-react";
import type React from "react";
import { useState } from "react";
import {
  type DropTarget,
  dropTargetAt,
  dropTargetLabel,
  useCardDrag,
} from "../hooks/useCardDrag";
import { useOutsidePress } from "../hooks/useOutsidePress";
import {
  type CardLooks,
  orderLabel,
  placeByOrder,
  totalCups,
} from "../logic/cards";
import type { NextAvailable } from "../logic/queue";
import { NextAvailableChips, PanelHeader } from "./BoardParts";
import { BayPad, MergeOverlay, OrderCard } from "./OrderCard";

// 未割当（管制盤 A の下の横帯と、管制盤 C の右の縦リスト）。
// カードをタップすると上下に 1〜6 のボタンが開き、押すか、指を離さずなぞるか、列へドラッグして割り当てる
// （待機のカードの上に落とすと、そのカードの前へ）。
// 1 杯のカードを開くと、統合できる 1 杯のカードに「統合する」が出る（onMergeOrders を渡したときだけ）。
export const UnassignedOrdersPanel: React.FC<{
  orders: CaosCard[];
  looks: CardLooks;
  nextAvailable: NextAvailable;
  layout?: "strip" | "sidebar";
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string | null) => void;
  onAssignToBay: (card: CaosCard, bayId: number, place?: CaosPlace) => void;
  onMergeOrders?: (firstKey: string, secondKey: string) => void;
}> = ({
  orders,
  looks,
  nextAvailable,
  layout = "strip",
  selectedOrderId,
  onSelectOrder,
  onAssignToBay,
  onMergeOrders,
}) => {
  const isSidebar = layout === "sidebar";
  const [openUid, setOpenUid] = useState<string | null>(null);
  const openOrder = orders.find((order) => order.key === openUid);
  const assign = (order: CaosCard, bayId: number, place?: CaosPlace) => {
    onAssignToBay(order, bayId, place);
    setOpenUid(null);
  };
  const drag = useCardDrag<CaosCard, DropTarget>({
    targetAt: (_order, x, y) => dropTargetAt(x, y),
    onBegin: (order) => {
      // Same as tapping another card: switching cards drops the old selection.
      if (openUid && openUid !== order.key) onSelectOrder(null);
      setOpenUid(order.key);
    },
    onDrop: (order, target) => assign(order, target.bayId, target.place),
  });

  // カードの外を押すと閉じる。未割当のカード（統合の相手・別のカード）を押したときは、そのカードのタップやドラッグで決める
  // （縦のリストでは、別のカードを押したのがスクロールのこともある）
  useOutsidePress(
    openUid !== null,
    (target) => Boolean(target.closest("[data-unassigned-uid]")),
    () => {
      setOpenUid(null);
      onSelectOrder(null);
    },
  );

  // 縦のリストは注文ごとに行を改め、1 行に 3 枚まで。横帯は先頭の 12 枚
  const placed: Array<{
    card: CaosCard;
    gridColumn?: number;
    gridRow?: number;
  }> = isSidebar
    ? placeByOrder(orders, 3)
    : orders.slice(0, 12).map((card) => ({ card }));

  return (
    <section
      className={`flex h-full flex-col rounded-lg border border-slate-300 bg-white shadow-xs ${isSidebar ? "overflow-hidden" : ""}`}
    >
      <PanelHeader icon={ClipboardList} title="未割当">
        <span className="shrink-0 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 font-bold font-mono text-[11px] text-red-600">
          {orders.length} 件 / {totalCups(orders)} 杯
        </span>
        {!isSidebar && <NextAvailableChips nextAvailable={nextAvailable} />}
      </PanelHeader>

      <div
        className={`grid min-h-0 flex-1 ${isSidebar ? "auto-rows-[112px] grid-cols-3 content-start gap-2 overflow-auto px-3 py-10" : "grid-cols-6 grid-rows-2 gap-1.5 p-2"}`}
      >
        {placed.map(({ card: order, gridColumn, gridRow }, index) => {
          const uid = order.key;
          const isOpen = openUid === uid;
          const isSelected = selectedOrderId === orderLabel(order);
          const isMergeCandidate = Boolean(
            onMergeOrders && openOrder && canMergeCards(openOrder, order),
          );
          // 横帯では注文の切れ目に印を付ける
          const isOrderBoundary =
            !isSidebar &&
            index > 0 &&
            placed[index - 1].card.orderNo !== order.orderNo;
          return (
            <OrderCard
              key={uid}
              card={order}
              look={looks.get(uid)}
              size={isSidebar ? "xl" : "lg"}
              selected={isSelected}
              data-unassigned-uid={uid}
              // A closed card in the scrolling list leaves vertical movement to scrolling.
              onPointerDown={
                isMergeCandidate
                  ? undefined
                  : (event) => drag.press(order, event, !isSidebar || isOpen)
              }
              onClickCapture={drag.suppressClick}
              onClick={() => {
                if (isMergeCandidate && openUid && onMergeOrders) {
                  onMergeOrders(openUid, uid);
                  setOpenUid(null);
                  return;
                }
                onSelectOrder(orderLabel(order));
                setOpenUid(uid);
              }}
              style={{ gridColumn, gridRow }}
              className={`cursor-grab hover:shadow-md active:cursor-grabbing ${isSidebar && !isOpen ? "touch-pan-y" : "touch-none"} ${isOpen ? "z-40" : ""}`}
              dragging={drag.source?.key === uid}
            >
              {isOrderBoundary && (
                <span
                  className="absolute top-2 bottom-2 left-0 w-[3px] rounded-r-full bg-slate-500"
                  aria-hidden="true"
                />
              )}
              {isMergeCandidate && <MergeOverlay />}
              {isOpen && (
                <BayPad
                  hoveredBay={drag.target?.bayId ?? null}
                  onPick={(bayId) => assign(order, bayId)}
                />
              )}
              {isSelected && (
                <div className="-top-2.5 absolute left-2 z-20 flex items-center gap-1 rounded-full bg-amber-500 px-2 py-0.5 font-bold text-[9px] text-white shadow-xs">
                  <Sparkles className="h-2.5 w-2.5" />
                  <span>連動選択中</span>
                </div>
              )}
            </OrderCard>
          );
        })}

        {orders.length === 0 && (
          <div className="col-span-full rounded-md border border-dashed py-8 text-center text-slate-400 text-xs">
            レジからのオーダーを待っています
          </div>
        )}
      </div>
      {drag.source &&
        drag.ghost(
          <OrderCard
            card={drag.source}
            look={looks.get(drag.source.key)}
            size={isSidebar ? "xl" : "lg"}
          />,
          dropTargetLabel(drag.target),
        )}
    </section>
  );
};
