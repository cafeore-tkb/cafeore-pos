import type { CaosCard, CaosPlace } from "@cafeore/common";
import { useEffect, useState } from "react";
import type { AuxiliaryTab } from "../components/SidePanels";
import { orderLabel } from "../logic/cards";
import { useCaosStateLog } from "./useCaosStateLog";

/**
 * 開いている右のパネル（同じ位置に出るので、開くのはいつも 1 つ。どれかを開くと前のものは閉じる）。
 * detail は待機のカードの詳細のパネル、rebrew は緊急（入れ直し）の入力（key は抽出中・終わりのカードから開いたときのそのカード。null ならヘッダーから番号で）、
 * assign は空きスロットへの割当、lane は列の操作（ドリッパーの番号を押して開く）、auxiliary は補助のタブ、search は注文番号の検索（digits は入れている番号）
 */
type OpenPanel =
  | { kind: "detail"; key: string }
  | { kind: "rebrew"; key: string | null }
  | { kind: "assign"; bayId: number }
  | { kind: "lane"; bayId: number }
  | { kind: "auxiliary"; tab: AuxiliaryTab }
  | { kind: "search"; digits: string }
  | null;

// 画面で選んでいるもの（注文・開いているパネル）と、選んだものへの操作。
// パネルはカードのキーだけを持ち、カードは毎回いまの盤面から読む（開いているあいだに始まった・終わったカードを古いまま扱わない）。
export const useBoardSelection = (
  cards: readonly CaosCard[],
  actions: {
    place: (key: string, bayId: number, place?: CaosPlace) => boolean;
    returnToUnassigned: (key: string) => boolean;
    merge: (firstKey: string, intoKey: string) => boolean;
    split: (key: string, cupId: string) => boolean;
    /** 緊急（入れ直し） */
    emergency: { cancel: (card: CaosCard) => void };
  },
) => {
  // 選んだ注文（orderLabel。同じ注文のカードを全部の列で光らせる）
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [panel, setPanel] = useState<OpenPanel>(null);
  useCaosStateLog("ui.selection.changed", { selectedOrderId, panel });
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
  // カードから入れ直すのは抽出中・終わりのカードだけ。盤面から消えたら（注文が消えた・待機に戻った）閉じ、注文の選択も外す
  const rebrewKey = panel?.kind === "rebrew" ? panel.key : null;
  const rebrewing = rebrewKey
    ? cards.find(
        (card) =>
          card.key === rebrewKey &&
          (card.status === "brewing" || card.status === "done"),
      )
    : undefined;
  useEffect(() => {
    if (rebrewKey && !rebrewing) {
      setPanel(null);
      setSelectedOrderId(null);
    }
  }, [rebrewKey, rebrewing]);

  const { emergency } = actions;
  // 動かしたら注文の選択を外す
  const thenDeselect = (ok: boolean) => {
    if (ok) setSelectedOrderId(null);
  };
  const placeCard = (card: CaosCard, bayId: number, place?: CaosPlace) =>
    thenDeselect(actions.place(card.key, bayId, place));

  return {
    selectedOrderId,
    selectOrder: setSelectedOrderId,
    /** 開いているパネル */
    panel,
    /** 開いている待機のカードと、そのドリッパー */
    scheduled,
    /** 緊急の入力を開いていれば、開いたカード（ヘッダーから開いたなら card は無い） */
    rebrew:
      panel?.kind === "rebrew" && (rebrewKey === null || rebrewing)
        ? { card: rebrewing }
        : null,
    /** 緊急の入力を番号から開く（ヘッダーの「緊急」。カードからは openCard） */
    openRebrew: () => setPanel({ kind: "rebrew", key: null }),
    /** 緊急の入力を閉じる（カードから開いていたら、注文の選択も外す） */
    closeRebrew: () => {
      close("rebrew");
      if (rebrewKey) setSelectedOrderId(null);
    },
    /** ドリッパーのカードを開き（長押し）、その注文を選ぶ。待機のカードは詳細のパネル、抽出中・終わりのカードは緊急の入力 */
    openCard: (card: CaosCard) => {
      setPanel({
        kind: card.status === "queued" ? "detail" : "rebrew",
        key: card.key,
      });
      setSelectedOrderId(orderLabel(card));
    },
    /** 待機のカードを閉じる（注文の選択も外す） */
    closeTicket: () => {
      close("detail");
      setSelectedOrderId(null);
    },
    openAssignSlot: (bayId: number) => setPanel({ kind: "assign", bayId }),
    closeAssignSlot: () => close("assign"),
    /** 列の操作（担当者の交代・待機をまとめて移す）を開く */
    openLane: (bayId: number) => setPanel({ kind: "lane", bayId }),
    closeLane: () => close("lane"),
    /** 注文番号の検索で入れている番号（開いていなければ null） */
    searchDigits: panel?.kind === "search" ? panel.digits : null,
    /** 注文番号の検索を開く（digits は入れておく番号） */
    openSearch: (digits: string) => setPanel({ kind: "search", digits }),
    /** 検索の番号を変える（開いているときだけ） */
    setSearchDigits: (update: (digits: string) => string) =>
      setPanel((open) =>
        open?.kind === "search"
          ? { kind: "search", digits: update(open.digits) }
          : open,
      ),
    closeSearch: () => close("search"),
    openAuxiliary: (tab: AuxiliaryTab) => setPanel({ kind: "auxiliary", tab }),
    closeAuxiliary: () => close("auxiliary"),
    /** 全部閉じる（リセット・実データテストの開始） */
    clear: () => {
      setSelectedOrderId(null);
      setPanel(null);
    },
    /** 未割当のカードをドリッパーへ（place が無ければ待機の最後へ） */
    assign: placeCard,
    /** 待機・抽出中のカードを別のドリッパーへ・先頭へ・カードの前へ */
    move: placeCard,
    returnToUnassigned: (card: CaosCard) =>
      thenDeselect(actions.returnToUnassigned(card.key)),
    merge: (firstKey: string, intoKey: string) =>
      thenDeselect(actions.merge(firstKey, intoKey)),
    /** 統合の解除（統合したカードから cupId の 1 杯を外す） */
    split: (card: CaosCard, cupId: string) =>
      thenDeselect(actions.split(card.key, cupId)),
    /** 入れ直しのカードの入れ直しを取り消し、注文の選択を外す */
    cancelEmergency: (card: CaosCard) => {
      emergency.cancel(card);
      setSelectedOrderId(null);
    },
  };
};
