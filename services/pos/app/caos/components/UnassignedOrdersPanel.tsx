import { ClipboardList, Sparkles } from "lucide-react";
import type React from "react";
import { useState } from "react";
import { bayTargetAt, useCardDrag } from "../hooks/useCardDrag";
import { useOutsidePress } from "../hooks/useOutsidePress";
import {
  canMergeDripUnits,
  groupByOrder,
  orderLabel,
  totalCups,
} from "../logic/cards";
import type { NextAvailable } from "../logic/queue";
import type { DripCard } from "../types";
import { NextAvailableChips, PanelHeader } from "./BoardParts";
import { BayPad, MergeOverlay, OrderCard } from "./OrderCard";

// 未割当（管制盤 A の下の横帯と、管制盤 C の右の縦リスト）。
// カードをタップすると上下に 1〜6 のボタンが開き、押すか、指を離さずなぞるか、列へドラッグして割り当てる。
// 1 杯のカードを開くと、統合できる 1 杯のカードに「統合する」が出る（onMergeOrders を渡したときだけ）。
export const UnassignedOrdersPanel: React.FC<{
  orders: DripCard[];
  nextAvailable: NextAvailable;
  layout?: "strip" | "sidebar";
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string) => void;
  onAssignToBay: (order: DripCard, bayId: number) => void;
  onMergeOrders?: (firstUid: string, secondUid: string) => void;
}> = ({
  orders,
  nextAvailable,
  layout = "strip",
  selectedOrderId,
  onSelectOrder,
  onAssignToBay,
  onMergeOrders,
}) => {
  const isSidebar = layout === "sidebar";
  const [openUid, setOpenUid] = useState<string | null>(null);
  const openOrder = orders.find((order) => order.ticketUid === openUid);
  const assign = (order: DripCard, bayId: number) => {
    onAssignToBay(order, bayId);
    setOpenUid(null);
  };
  const drag = useCardDrag<DripCard, number>({
    targetAt: (order, x, y) => bayTargetAt(x, y, order),
    onBegin: (order) => {
      // Same as tapping another card: switching cards drops the old selection.
      if (openUid && openUid !== order.ticketUid) onSelectOrder("");
      setOpenUid(order.ticketUid);
    },
    onDrop: assign,
  });

  // カードの外を押すと閉じる。未割当のカード（統合の相手・別のカード）を押したときは、そのカードのタップやドラッグで決める
  // （縦のリストでは、別のカードを押したのがスクロールのこともある）
  useOutsidePress(
    openUid !== null,
    (target) => Boolean(target.closest("[data-unassigned-uid]")),
    () => {
      setOpenUid(null);
      onSelectOrder("");
    },
  );

  // 縦のリストは注文ごとに行を改め、1 行に 3 枚まで
  const placed: Array<{
    order: DripCard;
    gridColumn?: number;
    gridRow?: number;
  }> = [];
  if (isSidebar) {
    let nextRow = 1;
    for (const group of groupByOrder(orders).values()) {
      for (const [index, order] of group.entries()) {
        placed.push({
          order,
          gridColumn: (index % 3) + 1,
          gridRow: nextRow + Math.floor(index / 3),
        });
      }
      nextRow += Math.ceil(group.length / 3);
    }
  } else {
    for (const order of orders.slice(0, 12)) placed.push({ order });
  }

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
        {placed.map(({ order, gridColumn, gridRow }, index) => {
          const uid = order.ticketUid;
          const isOpen = openUid === uid;
          const isSelected = selectedOrderId === orderLabel(order);
          const isMergeCandidate = Boolean(
            onMergeOrders && openOrder && canMergeDripUnits(openOrder, order),
          );
          // 横帯では注文の切れ目に印を付ける
          const isOrderBoundary =
            !isSidebar &&
            index > 0 &&
            placed[index - 1].order.orderNos[0] !== order.orderNos[0];
          return (
            <OrderCard
              key={uid}
              card={order}
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
                if (!isSelected) onSelectOrder(orderLabel(order));
                setOpenUid(uid);
              }}
              style={{ gridColumn, gridRow }}
              className={`cursor-grab hover:shadow-md active:cursor-grabbing ${isSidebar && !isOpen ? "touch-pan-y" : "touch-none"} ${isOpen ? "z-40" : ""}`}
              dragging={drag.source?.ticketUid === uid}
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
                  card={order}
                  hoveredBay={drag.target}
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
          <OrderCard card={drag.source} size={isSidebar ? "xl" : "lg"} />,
          drag.target ? `→ ${drag.target}` : null,
        )}
    </section>
  );
};
