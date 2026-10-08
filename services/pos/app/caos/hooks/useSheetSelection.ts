import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { type DripCard, canMergeDripUnits, orderLabel } from "../logic/cards";
import { canPlaceOn } from "../logic/lanes";

// 管制盤 D で選んでいる右の注文カード。選ぶとその注文の行に「ここに配置」が出る。
// 選んだ注文（App の selectedOrderId）が別の注文に変わったり、カードが無くなったりしたら選択を外す。
export const useSheetSelection = ({
  unassigned,
  selectedOrderId,
  onSelectOrder,
  onAssign,
  onMerge,
}: {
  unassigned: DripCard[];
  selectedOrderId: string | null;
  onSelectOrder: (orderId: string | null) => void;
  onAssign: (card: DripCard, bayId: number) => void;
  onMerge: (firstUid: string, secondUid: string) => void;
}) => {
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  // 統合して、盤面から統合したカードが届くのを待っている注文番号
  const [mergingNos, setMergingNos] = useState<number[] | null>(null);
  const selected =
    unassigned.find((card) => card.ticketUid === selectedUid) ?? null;

  useEffect(() => {
    if (selectedUid && !selected) setSelectedUid(null);
  }, [selected, selectedUid]);

  // App's selection can move on without this view (tapping a placed card, a move that clears it);
  // drop the local card selection then so the header and "ここに配置" never point at another order.
  useEffect(() => {
    if (selected && selectedOrderId !== orderLabel(selected))
      setSelectedUid(null);
  }, [selected, selectedOrderId]);

  const select = (card: DripCard) => {
    setSelectedUid(card.ticketUid);
    onSelectOrder(orderLabel(card));
  };
  const clear = () => {
    setSelectedUid(null);
    onSelectOrder(null);
  };

  // The combined card is listed under the earlier order, often far from the card just tapped,
  // so select it and bring it into view; it can then be placed right away.
  useEffect(() => {
    if (!mergingNos) return;
    const merged = unassigned.find(
      (card) =>
        card.orderNos.length > 1 &&
        mergingNos.every((no) => card.orderNos.includes(no)),
    );
    if (!merged) return;
    setMergingNos(null);
    setSelectedUid(merged.ticketUid);
    onSelectOrder(orderLabel(merged));
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-sheet-cup="${CSS.escape(merged.ticketUid)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [mergingNos, unassigned, onSelectOrder]);

  return {
    selected,
    select,
    clear,
    /** 選んだカードなら外し、ほかのカードなら選ぶ */
    toggle: (card: DripCard) => {
      if (card.ticketUid === selectedUid) clear();
      else select(card);
    },
    /** 選んだカードと統合できる */
    canMergeWith: (card: DripCard) =>
      Boolean(selected && canMergeDripUnits(selected, card)),
    mergeWith: (card: DripCard) => {
      if (!selected || !canMergeDripUnits(selected, card)) return;
      onMerge(selected.ticketUid, card.ticketUid);
      setMergingNos([...selected.orderNos, ...card.orderNos]);
      clear();
    },
    /** 選んだカードをそのドリッパーへ（「ここに配置」） */
    canAssignTo: (bayId: number) =>
      Boolean(selected && canPlaceOn(selected, bayId)),
    assignTo: (bayId: number) => {
      if (!selected || !canPlaceOn(selected, bayId)) return;
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
