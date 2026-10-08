import { useEffect, useState } from "react";
import { findTicket } from "../logic/board";
import { orderLabel } from "../logic/cards";
import type { RebrewDecision } from "../logic/rebrew";
import type { Board, DripCard, OrderTicket } from "../types";

// 画面で選んでいるもの（注文・待機のカード・空きスロット・入れ直しのカード）と、選んだものへの操作。
// パネルはカードのキーだけを持ち、カードは毎回いまの盤面から読む（開いているあいだに始まった・終わったカードを古いまま扱わない）。
export const useBoardSelection = (
  board: Board,
  actions: {
    assign: (uid: string, bayId: number) => boolean;
    move: (key: string, bayId: number) => boolean;
    returnToUnassigned: (key: string) => boolean;
    merge: (firstUid: string, secondUid: string) => boolean;
    rebrew: (key: string, decision: RebrewDecision) => boolean;
  },
) => {
  // 選んだ注文（orderLabel。同じ注文のカードを全部の列で光らせる）
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  // 1〜6 のボタン（管制盤 A）・詳細のパネル（管制盤 C・D）を開いた待機のカード
  const [ticketKey, setTicketKey] = useState<string | null>(null);
  const [assignSlotBayId, setAssignSlotBayId] = useState<number | null>(null);
  const [rebrewKey, setRebrewKey] = useState<string | null>(null);

  // 待機のカードだけ動かせるので、始まったら（終わったら）閉じる
  const found = ticketKey ? findTicket(board.baristas, ticketKey) : null;
  const scheduled = found?.ticket.status === "scheduled" ? found : null;
  useEffect(() => {
    if (ticketKey && !scheduled) setTicketKey(null);
  }, [ticketKey, scheduled]);
  // 入れ直しは抽出中・終わったカードから
  const rebrewFound = rebrewKey ? findTicket(board.baristas, rebrewKey) : null;
  const rebrewSource =
    rebrewFound?.ticket.status === "scheduled" ? null : rebrewFound;

  // 動かしたら注文の選択を外す
  const thenDeselect = (ok: boolean) => {
    if (ok) setSelectedOrderId(null);
  };

  return {
    selectedOrderId,
    selectOrder: setSelectedOrderId,
    /** 開いている待機のカードと、そのドリッパー */
    scheduled,
    openTicket: (ticket: OrderTicket) => setTicketKey(ticket.ticketUid),
    /** 詳細のパネルを開き、その注文を選ぶ */
    openDetail: (ticket: OrderTicket) => {
      setTicketKey(ticket.ticketUid);
      setSelectedOrderId(orderLabel(ticket));
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
    rebrewSource,
    openRebrew: (ticket: OrderTicket) => {
      setTicketKey(null);
      setRebrewKey(ticket.ticketUid);
    },
    closeRebrew: () => setRebrewKey(null),
    /** 全部閉じる（リセット・1つ戻す・実データテストの開始） */
    clear: () => {
      setSelectedOrderId(null);
      setTicketKey(null);
      setAssignSlotBayId(null);
      setRebrewKey(null);
    },
    assign: (card: DripCard, bayId: number) => {
      actions.assign(card.ticketUid, bayId);
    },
    move: (ticket: OrderTicket, bayId: number) =>
      thenDeselect(actions.move(ticket.ticketUid, bayId)),
    returnToUnassigned: (ticket: OrderTicket) =>
      thenDeselect(actions.returnToUnassigned(ticket.ticketUid)),
    merge: (firstUid: string, secondUid: string) =>
      thenDeselect(actions.merge(firstUid, secondUid)),
    /** 入れ直す。入れ直した注文を選んでおく */
    rebrew: (decision: RebrewDecision) => {
      if (!rebrewSource) return;
      if (!actions.rebrew(rebrewSource.ticket.ticketUid, decision)) return;
      setRebrewKey(null);
      setTicketKey(null);
      setSelectedOrderId(orderLabel(rebrewSource.ticket));
    },
  };
};
