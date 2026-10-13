import type { CaosCard } from "@cafeore/common";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  canTapMerge,
  cardOrderNos,
  orderLabel,
  quickMergePartner,
} from "../logic/cards";
import { type Lane, laneActive } from "../logic/lanes";

// 管制盤 D で選んでいる右の注文カード。選ぶとその注文の行に「ここに配置」が出る。
// 統合できる未割当のカードと表の抽出中のカードには「統合する」が出て、押すと統合する（待機のカードへは押して統合しない）。
// 統合する相手が決まる（logic/cards の quickMergePartner。未割当と表の抽出中のカードから）ときは、選んだカードをもう一度押すと統合する（決まらなければ選択を外す）。
// 選んだ注文（App の selectedOrderId）が別の注文に変わったり、カードが無くなったりしたら選択を外す。
export const useSheetSelection = ({
  unassigned,
  lanes,
  selectedOrderId,
  onSelectOrder,
  onAssign,
  onMerge,
}: {
  unassigned: CaosCard[];
  /** ドリッパーの列（表の抽出中のカードも、もう一度押して統合する相手の候補） */
  lanes: readonly Lane[];
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string | null) => void;
  onAssign: (card: CaosCard, bayId: number) => void;
  onMerge: (firstUid: string, secondUid: string) => void;
}) => {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  // 統合して、盤面から統合したカードが届くのを待っている注文番号
  const [mergingNos, setMergingNos] = useState<number[] | null>(null);
  const selected = unassigned.find((card) => card.key === selectedUid) ?? null;
  const canMergeWith = (card: CaosCard) =>
    Boolean(selected && canTapMerge(selected, card));

  useEffect(() => {
    if (selectedUid && !selected) setSelectedUid(null);
  }, [selected, selectedUid]);

  // App's selection can move on without this view (tapping a placed card, a move that clears it);
  // drop the local card selection then so the header and "ここに配置" never point at another order.
  useEffect(() => {
    if (selected && selectedOrderId !== orderLabel(selected))
      setSelectedUid(null);
  }, [selected, selectedOrderId]);

  const select = (card: CaosCard) => {
    setSelectedUid(card.key);
    onSelectOrder(orderLabel(card));
  };
  const clear = () => {
    setSelectedUid(null);
    onSelectOrder(null);
  };
  // 押したカードに統合する。未割当どうしなら、統合したカードを選んで見せる
  const mergeWith = (card: CaosCard) => {
    if (!selected || !canMergeWith(card)) return;
    onMerge(selected.key, card.key);
    if (card.status === "unassigned")
      setMergingNos([...cardOrderNos(selected), ...cardOrderNos(card)]);
    clear();
  };
  // 選んだカードをもう一度押したときに統合する相手
  const partner = selected
    ? quickMergePartner(selected, [...unassigned, ...lanes.flatMap(laneActive)])
    : undefined;

  // The combined card is listed under the earlier order, often far from the card just tapped,
  // so select it and bring it into view; it can then be placed right away.
  useEffect(() => {
    if (!mergingNos) return;
    const merged = unassigned.find(
      (card) =>
        cardOrderNos(card).length > 1 &&
        mergingNos.every((no) => cardOrderNos(card).includes(no)),
    );
    if (!merged) return;
    setMergingNos(null);
    setSelectedUid(merged.key);
    onSelectOrder(orderLabel(merged));
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-sheet-cup="${CSS.escape(merged.key)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [mergingNos, unassigned, onSelectOrder]);

  return {
    selected,
    select,
    clear,
    partner,
    /** 選んだカードなら、統合する相手が決まっていれば統合し、決まらなければ外す。ほかのカードなら選ぶ */
    toggle: (card: CaosCard) => {
      if (card.key !== selectedUid) select(card);
      else if (partner) mergeWith(partner);
      else clear();
    },
    /** 選んだカードと押して統合できる（未割当と抽出中のカード） */
    canMergeWith,
    mergeWith,
    /** 選んだカードをそのドリッパーへ（「ここに配置」） */
    assignTo: (bayId: number) => {
      if (!selected) return;
      onAssign(selected, bayId);
      clear();
    },
  };
};

// 表を開いたときだけ、まだ淹れ終わっていない最初の注文（data-live）の historyRows 行上までスクロールする。
// そのあとのスクロールは見ている人に任せる
export const useScrollToFirstLive = (historyRows: number) => {
  const ref = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 開いたときの 1 回だけ
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;
    const rows = Array.from(
      container.querySelectorAll<HTMLElement>("[data-sheet-row]"),
    );
    const firstLive = rows.findIndex((row) => row.dataset.live === "true");
    const row =
      rows[
        Math.max(0, (firstLive === -1 ? rows.length : firstLive) - historyRows)
      ];
    const head = container.querySelector("thead");
    if (!row || !head) return;
    container.scrollTop +=
      row.getBoundingClientRect().top -
      container.getBoundingClientRect().top -
      head.getBoundingClientRect().height;
  }, []);
  return ref;
};
