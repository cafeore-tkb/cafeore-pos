import type { CaosCard, CaosPlace } from "@cafeore/common";
import { useEffect, useState } from "react";
import { orderLabel } from "../logic/cards";

// 画面で選んでいるもの（注文・待機のカード・空きスロット）と、選んだものへの操作。
// パネルはカードのキーだけを持ち、カードは毎回いまの盤面から読む（開いているあいだに始まった・終わったカードを古いまま扱わない）。
export const useBoardSelection = (
  cards: readonly CaosCard[],
  actions: {
    place: (key: string, bayId: number, place?: CaosPlace) => boolean;
    returnToUnassigned: (key: string) => boolean;
    merge: (firstKey: string, secondKey: string) => boolean;
  },
) => {
  // 選んだ注文（orderLabel。同じ注文のカードを全部の列で光らせる）
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  // 1〜6 のボタン（管制盤 A）・詳細のパネル（管制盤 C・D）を開いた待機のカード
  const [ticketKey, setTicketKey] = useState<string | null>(null);
  const [assignSlotBayId, setAssignSlotBayId] = useState<number | null>(null);

  // 待機のカードだけ動かせるので、始まったら（終わったら・未割当に戻ったら）閉じる
  const found = ticketKey
    ? cards.find((card) => card.key === ticketKey)
    : undefined;
  const scheduled =
    found?.status === "queued" && found.dripper !== null
      ? { card: found, bayId: found.dripper }
      : null;
  useEffect(() => {
    if (ticketKey && !scheduled) setTicketKey(null);
  }, [ticketKey, scheduled]);

  // 動かしたら注文の選択を外す
  const thenDeselect = (ok: boolean) => {
    if (ok) setSelectedOrderId(null);
  };

  return {
    selectedOrderId,
    selectOrder: setSelectedOrderId,
    /** 開いている待機のカードと、そのドリッパー */
    scheduled,
    openTicket: (card: CaosCard) => setTicketKey(card.key),
    /** 詳細のパネルを開き、その注文を選ぶ */
    openDetail: (card: CaosCard) => {
      setTicketKey(card.key);
      setSelectedOrderId(orderLabel(card));
    },
    closeTicket: () => setTicketKey(null),
    /** 詳細のパネルを閉じる（注文の選択も外す） */
    closeDetail: () => {
      setTicketKey(null);
      setSelectedOrderId(null);
    },
    assignSlotBayId,
    openAssignSlot: setAssignSlotBayId,
    closeAssignSlot: () => setAssignSlotBayId(null),
    /** 全部閉じる（リセット・実データテストの開始） */
    clear: () => {
      setSelectedOrderId(null);
      setTicketKey(null);
      setAssignSlotBayId(null);
    },
    /** 未割当のカードをドリッパーへ（place が無ければ待機の最後へ） */
    assign: (card: CaosCard, bayId: number, place?: CaosPlace) => {
      actions.place(card.key, bayId, place);
    },
    /** 待機のカードを別のドリッパーへ・先頭へ・カードの前へ */
    move: (card: CaosCard, bayId: number, place?: CaosPlace) =>
      thenDeselect(actions.place(card.key, bayId, place)),
    returnToUnassigned: (card: CaosCard) =>
      thenDeselect(actions.returnToUnassigned(card.key)),
    merge: (firstKey: string, secondKey: string) =>
      thenDeselect(actions.merge(firstKey, secondKey)),
  };
};
