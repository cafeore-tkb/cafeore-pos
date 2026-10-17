import { type CaosCard, type CaosPlace, canMergeCards } from "@cafeore/common";
import { useState } from "react";
import type { ControlViewProps } from "../components/ControlWorkspace";
import { orderLabel, quickMergePartner } from "../logic/cards";
import { laneActive } from "../logic/lanes";
import { useCaosStateLog } from "./useCaosStateLog";
import {
  type DropTarget,
  dropTargetAt,
  useAnyCardDragging,
  useCardDrag,
} from "./useCardDrag";
import { useOutsidePress } from "./useOutsidePress";

/**
 * 未割当のカードの操作（管制盤 A の下の横帯と、管制盤 C の右の注文の列で共通）。
 * カードをタップすると上下に 1〜6 のボタンが開き（開いたカード）、押すか、指を離さずなぞるか、列へドラッグして割り当てる
 * （列の待機・抽出中のカードの上に落とすと、左の端はそのカードの前・右の端は後ろ・真ん中は統合（placed のうち統合できるカードだけ）。
 * useCardDrag の dropTargetAt）。
 * 1 杯のカードを開くと、統合できる 1 杯のカード（未割当と、ドリッパーの列の待機・抽出中のカード。canMergeCards）を押して統合できる
 * （onMergeOrders を渡したときだけ。統合できるカードには OrderCard の mergeTap が data-merge-tap を付け、押しても開いたカードを閉じない）。
 * 相手が決まる（logic/cards の quickMergePartner。未割当と placed の待機・抽出中のカードから）ときは、開いたカードをもう一度押しても統合する
 * （決まらなければ開いたまま）。
 * 統合したカードを開くと 1 杯ずつ外せる（onSplitCup を渡したときだけ）。
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
  useCaosStateLog("ui.unassigned-menu.changed", { openKey });
  const openCard = orders.find((order) => order.key === openKey);
  const assign = (card: CaosCard, bayId: number, place?: CaosPlace) => {
    onAssignToBay(card, bayId, place);
    setOpenKey(null);
  };
  const drag = useCardDrag<CaosCard, DropTarget>({
    targetAt: (card, x, y) =>
      dropTargetAt(x, y, {
        card,
        cards: placed,
        merge: Boolean(onMergeOrders),
      }),
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

  // カードの外を押すと閉じる。未割当のカード（統合の相手・別のカード）と統合できる待機・抽出中のカードを押したときは、そのカードのタップやドラッグで決める
  // （スクロールする列では、別のカードを押したのがスクロールのこともある）
  useOutsidePress(
    openKey !== null,
    (target) =>
      Boolean(
        target.closest(
          "[data-unassigned-uid], [data-merge-tap], [data-unassigned-slot]",
        ),
      ),
    () => {
      setOpenKey(null);
      onSelectOrder(null);
    },
  );

  // どこかでドラッグしているあいだは「統合する」を出さない（落とす所の線・統合の枠を隠さない）
  const dragging = useAnyCardDragging();
  const canMergeWith = (card: CaosCard) =>
    Boolean(
      onMergeOrders && openCard && !dragging && canMergeCards(openCard, card),
    );
  // 開いたカードをもう一度押したときに統合する相手
  const partner =
    onMergeOrders && openCard
      ? quickMergePartner(openCard, [...orders, ...placed])
      : undefined;

  return {
    drag,
    assign,
    /** 未割当で現在選んでいるカード（空きスロットを押して割当可能） */
    openCard,
    isOpen: (card: CaosCard) => card.key === openKey,
    canMergeWith,
    partner,
    /** 統合したカードから 1 杯を外して閉じる（onSplitCup を渡したときだけ） */
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
    /** カードを押した：統合できる相手（開いたカードなら決まった相手）と統合し、ほかは開いてその注文を選ぶ */
    tap: (card: CaosCard) => {
      const into = card.key === openKey ? partner : card;
      if (openCard && into && canMergeWith(into)) {
        onMergeOrders?.(openCard.key, into.key);
        setOpenKey(null);
        return;
      }
      onSelectOrder(orderLabel(card));
      setOpenKey(card.key);
    },
  };
};
export type UnassignedPick = ReturnType<typeof useUnassignedPick>;

/** 管制盤 A・C の未割当のカードの操作。未割当（A の横帯・C の注文の列）と、ドリッパーの列の待機・抽出中のカード（タップで統合する相手）で共有する */
export const useControlPick = (props: ControlViewProps) =>
  useUnassignedPick({
    orders: props.unassignedOrders,
    placed: props.lanes.flatMap(laneActive),
    onSelectOrder: props.onSelectOrder,
    onAssignToBay: props.onAssignToBay,
    onMergeOrders: props.onMergeOrders,
    onSplitCup: props.onSplitCup,
    onCancelEmergency: props.onCancelEmergency,
  });
