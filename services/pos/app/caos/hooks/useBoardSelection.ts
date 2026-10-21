import type { CaosCard, CaosPlace } from "@cafeore/common";
import { type SetStateAction, useCallback, useEffect, useState } from "react";
import type { AuxiliaryTab } from "../components/SidePanels";
import { orderLabel } from "../logic/cards";
import { useCaosStateLog } from "./useCaosStateLog";

/**
 * 操作パネル。選択中の1つだけを表示し、別の画面を開いたら置き換える。
 * detail は待機のカードの詳細のパネル、rebrew は緊急（淹れ直し）の入力（key は抽出中・終わりのカードから開いたときのそのカード。null ならヘッダーから番号で）、
 * assign は空きスロットへの割当、lane は列の操作（ドリッパーの番号を押して開く）、auxiliary は補助のタブ、search は注文番号の検索（digits は入れている番号）、comment は任意の注文へのコメント入力
 */
export type OpenPanel =
  | { kind: "detail"; key: string }
  | { kind: "rebrew"; key: string | null }
  | { kind: "assign"; bayId: number }
  | { kind: "lane"; bayId: number }
  | { kind: "auxiliary"; tab: AuxiliaryTab }
  | { kind: "search"; digits: string }
  | { kind: "pastOrders" }
  | { kind: "comment" }
  | null;

const panelKey = (item: NonNullable<OpenPanel>) =>
  item.kind === "detail" || item.kind === "rebrew"
    ? `${item.kind}:${item.key}`
    : item.kind === "lane" || item.kind === "assign"
      ? `${item.kind}:${item.bayId}`
      : item.kind === "auxiliary"
        ? `${item.kind}:${item.tab}`
        : item.kind;

// 画面で選んでいるもの（注文・開いているパネル）と、選んだものへの操作。
// パネルはカードのキーだけを持ち、カードは毎回いまの盤面から読む（開いているあいだに始まった・終わったカードを古いまま扱わない）。
export const useBoardSelection = (
  cards: readonly CaosCard[],
  actions: {
    place: (key: string, bayId: number, place?: CaosPlace) => boolean;
    returnToUnassigned: (key: string) => boolean;
    merge: (firstKey: string, intoKey: string) => boolean;
    split: (key: string, cupId: string) => boolean;
    /** 緊急（淹れ直し） */
    emergency: { cancel: (card: CaosCard) => void };
  },
) => {
  // 選んだ注文（orderLabel。同じ注文のカードを全部の列で光らせる）
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [{ panel, panels }, setPanelState] = useState<{
    panel: OpenPanel;
    panels: NonNullable<OpenPanel>[];
  }>({ panel: null, panels: [] });
  const setPanel = useCallback((update: SetStateAction<OpenPanel>) => {
    setPanelState((state) => {
      const next = typeof update === "function" ? update(state.panel) : update;
      return {
        panel: next,
        panels: next
          ? [next]
          : state.panels.filter(
              (item) =>
                !state.panel || panelKey(item) !== panelKey(state.panel),
            ),
      };
    });
  }, []);
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
  // カードから淹れ直すのは抽出中・終わりのカードだけ。盤面から消えたら（注文が消えた・待機に戻った）閉じ、注文の選択も外す
  const rebrewKey = panel?.kind === "rebrew" ? panel.key : null;
  const rebrewing = rebrewKey
    ? cards.find(
        (card) =>
          card.key === rebrewKey &&
          (card.status === "brewing" || card.status === "done"),
      )
    : undefined;
  useEffect(() => {
    // 非表示のパネルも含め、対象の状態が変わった時点で終了する。
    const valid = (item: NonNullable<OpenPanel>) => {
      if (item.kind !== "detail" && item.kind !== "rebrew") return true;
      if (item.kind === "rebrew" && item.key === null) return true;
      const card = cards.find((card) => card.key === item.key);
      return item.kind === "detail"
        ? card?.status === "queued" && card.dripper !== null
        : card?.status === "brewing" || card?.status === "done";
    };
    setPanelState((state) => {
      const retained = state.panels.filter(valid);
      const active = state.panel && valid(state.panel) ? state.panel : null;
      return retained.length === state.panels.length && active === state.panel
        ? state
        : { panel: active, panels: retained };
    });
    if (panel?.kind === "rebrew" && panel.key !== null && !valid(panel))
      setSelectedOrderId(null);
  }, [cards, panel]);

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
    panels,
    panelKey,
    activatePanel: (item: NonNullable<OpenPanel>) =>
      setPanelState((state) => ({
        ...state,
        panel:
          state.panels.find((saved) => panelKey(saved) === panelKey(item)) ??
          state.panel,
      })),
    suspendPanel: (item: NonNullable<OpenPanel>) =>
      setPanelState((state) => ({
        ...state,
        panel:
          state.panel && panelKey(state.panel) === panelKey(item)
            ? null
            : state.panel,
      })),
    closePanel: (item: NonNullable<OpenPanel>) => {
      const id = panelKey(item);
      if (
        panel &&
        panelKey(panel) === id &&
        (item.kind === "detail" ||
          (item.kind === "rebrew" && item.key !== null))
      )
        setSelectedOrderId(null);
      setPanelState((state) => ({
        panels: state.panels.filter((saved) => panelKey(saved) !== id),
        panel: state.panel && panelKey(state.panel) === id ? null : state.panel,
      }));
    },
    /** 開いている待機のカードと、そのドリッパー */
    scheduled,
    /** 緊急の入力を開いていれば、開いたカード（ヘッダーから開いたなら card は無い） */
    rebrew:
      panel?.kind === "rebrew" && (rebrewKey === null || rebrewing)
        ? { card: rebrewing }
        : null,
    /** 緊急の入力を番号から開く（ヘッダーの「緊急」。カードからは openCard） */
    openRebrew: () => setPanel({ kind: "rebrew", key: null }),
    openPastOrders: () => setPanel({ kind: "pastOrders" }),
    openComment: () => setPanel({ kind: "comment" }),
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
      setPanelState({ panel: null, panels: [] });
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
    /** 淹れ直しのカードの淹れ直しを取り消し、注文の選択を外す */
    cancelEmergency: (card: CaosCard) => {
      emergency.cancel(card);
      setSelectedOrderId(null);
    },
  };
};
