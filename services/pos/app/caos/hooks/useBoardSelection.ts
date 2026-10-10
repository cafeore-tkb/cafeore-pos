import type { CaosCard, CaosPlace } from "@cafeore/common";
import { useEffect, useState } from "react";
import type { AuxiliaryTab } from "../components/SidePanels";
import { orderLabel } from "../logic/cards";

/**
 * 開いている右のパネル（同じ位置に出るので、開くのはいつも 1 つ。どれかを開くと前のものは閉じる）。
 * detail は待機のカード（管制盤 A では 1〜6 のボタン、管制盤 C・D では詳細のパネル）、assign は空きスロットへの割当、auxiliary は補助のタブ
 */
type OpenPanel =
  | { kind: "detail"; key: string }
  | { kind: "assign"; bayId: number }
  | { kind: "auxiliary"; tab: AuxiliaryTab }
  | null;

// 画面で選んでいるもの（注文・開いているパネル）と、選んだものへの操作。
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
  const [panel, setPanel] = useState<OpenPanel>(null);
  // 閉じるのは、そのパネルが開いているときだけ（ほかのパネルに替わっていたら何もしない）
  const close = (kind: NonNullable<OpenPanel>["kind"]) =>
    setPanel((open) => (open?.kind === kind ? null : open));

  // 待機のカードだけ動かせるので、始まったら（終わったら・未割当に戻ったら）閉じる
  const ticketKey = panel?.kind === "detail" ? panel.key : null;
  const found = ticketKey
    ? cards.find((card) => card.key === ticketKey)
    : undefined;
  const scheduled =
    found?.status === "queued" && found.dripper !== null
      ? { card: found, bayId: found.dripper }
      : null;
  useEffect(() => {
    if (ticketKey && !scheduled) setPanel(null);
  }, [ticketKey, scheduled]);

  // 動かしたら注文の選択を外す
  const thenDeselect = (ok: boolean) => {
    if (ok) setSelectedOrderId(null);
  };

  return {
    selectedOrderId,
    selectOrder: setSelectedOrderId,
    /** 開いているパネル */
    panel,
    /** 開いている待機のカードと、そのドリッパー */
    scheduled,
    openTicket: (card: CaosCard) => setPanel({ kind: "detail", key: card.key }),
    /** 詳細のパネルを開き、その注文を選ぶ */
    openDetail: (card: CaosCard) => {
      setPanel({ kind: "detail", key: card.key });
      setSelectedOrderId(orderLabel(card));
    },
    closeTicket: () => close("detail"),
    /** 詳細のパネルを閉じる（注文の選択も外す） */
    closeDetail: () => {
      close("detail");
      setSelectedOrderId(null);
    },
    openAssignSlot: (bayId: number) => setPanel({ kind: "assign", bayId }),
    closeAssignSlot: () => close("assign"),
    openAuxiliary: (tab: AuxiliaryTab) => setPanel({ kind: "auxiliary", tab }),
    closeAuxiliary: () => close("auxiliary"),
    /** 全部閉じる（リセット・実データテストの開始） */
    clear: () => {
      setSelectedOrderId(null);
      setPanel(null);
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
