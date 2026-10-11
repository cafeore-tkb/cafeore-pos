import { type CaosCard, type CaosPlace, canMergeCards } from "@cafeore/common";
import { useState } from "react";
import { orderLabel } from "../logic/cards";
import { type DropTarget, dropTargetAt, useCardDrag } from "./useCardDrag";
import { useOutsidePress } from "./useOutsidePress";

/**
 * 未割当のカードの操作（管制盤 A の下の横帯と、管制盤 C の右の注文の列で共通）。
 * カードをタップすると上下に 1〜6 のボタンが開き（開いたカード）、押すか、指を離さずなぞるか、列へドラッグして割り当てる
 * （待機のカードの上に落とすと、そのカードの前へ。placed のうち統合できる待機・抽出中のカードの上なら統合）。
 * 1 杯のカードを開くと、統合できる 1 杯のカードを押して統合できる（onMergeOrders を渡したときだけ）。
 * 2 杯のカードを開くと 1 杯ずつ外せる（onSplitCup を渡したときだけ）。
 * 入れ直し（緊急）のカードを開くと取り消せる（onCancelEmergency を渡したときだけ）。
 */
export const useUnassignedPick = ({
  orders,
  placed = [],
  onSelectOrder,
  onAssignToBay,
  onMergeOrders,
  onSplitCup,
  onCancelEmergency,
}: {
  orders: readonly CaosCard[];
  /** ドリッパーに置いたカード（ドラッグで統合する相手を引く） */
  placed?: readonly CaosCard[];
  onSelectOrder: (orderId: string | null) => void;
  onAssignToBay: (card: CaosCard, bayId: number, place?: CaosPlace) => void;
  onMergeOrders?: (firstKey: string, intoKey: string) => void;
  onSplitCup?: (card: CaosCard, cupId: string) => void;
  onCancelEmergency?: (card: CaosCard) => void;
}) => {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openCard = orders.find((order) => order.key === openKey);
  const assign = (card: CaosCard, bayId: number, place?: CaosPlace) => {
    onAssignToBay(card, bayId, place);
    setOpenKey(null);
  };
  const drag = useCardDrag<CaosCard, DropTarget>({
    targetAt: (card, x, y) =>
      dropTargetAt(x, y, { card, cards: onMergeOrders ? placed : [] }),
    onBegin: (card) => {
      // Same as tapping another card: switching cards drops the old selection.
      if (openKey && openKey !== card.key) onSelectOrder(null);
      setOpenKey(card.key);
    },
    onDrop: (card, target) => {
      if (!target.mergeKey) return assign(card, target.bayId, target.place);
      onMergeOrders?.(card.key, target.mergeKey);
      setOpenKey(null);
    },
  });

  // カードの外を押すと閉じる。未割当のカード（統合の相手・別のカード）を押したときは、そのカードのタップやドラッグで決める
  // （スクロールする列では、別のカードを押したのがスクロールのこともある）
  useOutsidePress(
    openKey !== null,
    (target) => Boolean(target.closest("[data-unassigned-uid]")),
    () => {
      setOpenKey(null);
      onSelectOrder(null);
    },
  );

  const canMergeWith = (card: CaosCard) =>
    Boolean(onMergeOrders && openCard && canMergeCards(openCard, card));

  return {
    drag,
    assign,
    isOpen: (card: CaosCard) => card.key === openKey,
    canMergeWith,
    /** 2 杯のカードから 1 杯を外して閉じる（onSplitCup を渡したときだけ） */
    split:
      onSplitCup &&
      ((card: CaosCard, cupId: string) => {
        onSplitCup(card, cupId);
        setOpenKey(null);
      }),
    /** 入れ直し（緊急）のカードを取り消して閉じる（onCancelEmergency を渡したときだけ） */
    cancelEmergency:
      onCancelEmergency &&
      ((card: CaosCard) => {
        onCancelEmergency(card);
        setOpenKey(null);
      }),
    /** カードを押した：統合できる相手なら統合し、ほかは開いてその注文を選ぶ */
    tap: (card: CaosCard) => {
      if (openCard && onMergeOrders && canMergeCards(openCard, card)) {
        onMergeOrders(openCard.key, card.key);
        setOpenKey(null);
        return;
      }
      onSelectOrder(orderLabel(card));
      setOpenKey(card.key);
    },
  };
};
export type UnassignedPick = ReturnType<typeof useUnassignedPick>;
