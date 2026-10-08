import type { Barista, Board, DripCard, OrderTicket } from "../types";
import {
  canMergeDripUnits,
  mergeCards,
  orderLabel,
  toCard,
  toTicket,
} from "./cards";
import { canPlaceOn, laneOrdinal, makeLaneBaristas } from "./lanes";
import { arrangeQueue, scheduleQueue } from "./queue";
import { type RebrewDecision, rebrewSlots } from "./rebrew";

// 盤面の操作。どれも今の盤面から次の盤面を返す（できない操作は null）。
// label は「1つ戻す」に出す操作の名前。

export type BoardChange = { board: Board; label: string } | null;

export const emptyBoard = (): Board => ({
  baristas: makeLaneBaristas(),
  unassigned: [],
});

/** 届いたカードを未割当に足し、取り下げられたカード（isWithdrawn）を未割当から外す。変わらなければ同じ盤面 */
export const receiveCards = (
  board: Board,
  incoming: DripCard[],
  isWithdrawn?: (card: DripCard) => boolean,
): Board => {
  const remaining = isWithdrawn
    ? board.unassigned.filter((card) => !isWithdrawn(card))
    : board.unassigned;
  if (incoming.length === 0 && remaining.length === board.unassigned.length)
    return board;
  return { ...board, unassigned: [...remaining, ...incoming] };
};

/** 1つ戻す。戻し先の盤面に、そのあとに届いたカード（arrivals）を足す（戻しても届いた注文は消さない） */
export const restoreBoard = (snapshot: Board, arrivals: DripCard[]): Board => {
  const restored = new Set(snapshot.unassigned.map((card) => card.ticketUid));
  return receiveCards(
    snapshot,
    arrivals.filter((card) => !restored.has(card.ticketUid)),
  );
};

/** ドリッパーのカード（抽出中・待機・終わり）と、そのドリッパー */
export const findTicket = (baristas: Barista[], key: string) =>
  ticketsWhere(baristas, (ticket) => ticket.ticketUid === key)[0] ?? null;

/** 条件に合うドリッパーのカード（終わり・抽出中・待機）と、そのドリッパー */
export const ticketsWhere = (
  baristas: Barista[],
  predicate: (ticket: OrderTicket) => boolean,
) =>
  baristas.flatMap((barista) =>
    [...barista.pastTickets, ...barista.queue]
      .filter(predicate)
      .map((ticket) => ({ ticket, bayId: barista.id })),
  );

const findUnassigned = (board: Board, uid: string) =>
  board.unassigned.find((card) => card.ticketUid === uid);

const withoutUnassigned = (board: Board, uids: string[]) =>
  board.unassigned.filter((card) => !uids.includes(card.ticketUid));

// 待機のカード（まだ始めていないカード）。抽出中・終わりのカードは動かせない
const findScheduled = (board: Board, key: string) => {
  const found = findTicket(board.baristas, key);
  return found?.ticket.status === "scheduled" ? found.ticket : null;
};

// 列ごとに、待機の並べ直し（arrangeQueue）をする
const rearrange = (
  baristas: Barista[],
  nowSec: number,
  queueOf: (barista: Barista) => OrderTicket[],
) =>
  baristas.map((barista) => ({
    ...barista,
    queue: arrangeQueue(queueOf(barista), nowSec),
  }));

/** 未割当のカードをドリッパーへ */
export const assignCard = (
  board: Board,
  uid: string,
  bayId: number,
  nowSec: number,
): BoardChange => {
  const card = findUnassigned(board, uid);
  if (!card || !canPlaceOn(card, bayId)) return null;
  return {
    label: `${orderLabel(card)}の割当`,
    board: {
      unassigned: withoutUnassigned(board, [uid]),
      baristas: rearrange(board.baristas, nowSec, (barista) =>
        barista.id === bayId
          ? [...barista.queue, toTicket(card)]
          : barista.queue,
      ),
    },
  };
};

/** 待機のカードを別のドリッパーへ */
export const moveTicket = (
  board: Board,
  key: string,
  bayId: number,
  nowSec: number,
): BoardChange => {
  const ticket = findScheduled(board, key);
  if (!ticket || !canPlaceOn(ticket, bayId)) return null;
  return {
    label: `${orderLabel(ticket)}の割当変更`,
    board: {
      ...board,
      baristas: rearrange(board.baristas, nowSec, (barista) => {
        const queue = barista.queue.filter((item) => item.ticketUid !== key);
        return barista.id === bayId ? [...queue, ticket] : queue;
      }),
    },
  };
};

/** 待機のカードを未割当に戻す */
export const returnTicket = (
  board: Board,
  key: string,
  nowSec: number,
): BoardChange => {
  const ticket = findScheduled(board, key);
  if (!ticket) return null;
  return {
    label: `${orderLabel(ticket)}を未割当に戻す`,
    board: {
      unassigned: [toCard(ticket), ...board.unassigned],
      baristas: rearrange(board.baristas, nowSec, (barista) =>
        barista.queue.filter((item) => item.ticketUid !== key),
      ),
    },
  };
};

/** 「次へ」。抽出中のカードを終え、待機を注文番号の順に並べ直して先頭を今から始める */
export const advanceBay = (
  board: Board,
  bayId: number,
  nowSec: number,
): BoardChange => {
  const barista = board.baristas.find((item) => item.id === bayId);
  const [head, ...rest] = barista?.queue ?? [];
  if (!head) return null;
  return {
    label: `${laneOrdinal(bayId)}の「次へ」`,
    board: {
      ...board,
      baristas: board.baristas.map((item) =>
        item.id === bayId
          ? {
              ...item,
              // Re-anchor the entire downstream queue to the actual completion time.
              queue: arrangeQueue(rest, nowSec),
              pastTickets: [
                ...item.pastTickets,
                { ...head, status: "completed", endTimeSec: nowSec },
              ],
            }
          : item,
      ),
    },
  };
};

/** 未割当の 1 杯どうしを、2 杯の同時抽出へ統合する */
export const mergeUnassigned = (
  board: Board,
  firstUid: string,
  secondUid: string,
): BoardChange => {
  const first = findUnassigned(board, firstUid);
  const second = findUnassigned(board, secondUid);
  if (!first || !second || !canMergeDripUnits(first, second)) return null;
  return {
    label: `${orderLabel(first)}と${orderLabel(second)}の統合`,
    board: {
      ...board,
      unassigned: [
        ...withoutUnassigned(board, [firstUid, secondUid]),
        mergeCards(first, second),
      ],
    },
  };
};

/** 緊急の入れ直し。抽出中・終わったカードから、同じ中身のカードを作り直す */
export const rebrew = (
  board: Board,
  key: string,
  decision: RebrewDecision,
  nowSec: number,
  uid: string,
): BoardChange => {
  const found = findTicket(board.baristas, key);
  if (!found || found.ticket.status === "scheduled") return null;
  const { ticket, bayId: sourceBayId } = found;
  const source = {
    ticket,
    sourceBayId,
    interruptCurrent: decision.interruptCurrent,
  };
  // 置くドリッパーは、選べる差し込み位置（logic/rebrew の rebrewSlots）を選んだときだけ
  const target = board.baristas.find(
    (barista) => barista.id === decision.targetBayId,
  );
  if (
    target &&
    !rebrewSlots(target, source).slots.some(
      (slot) => slot.index === decision.insertIndex,
    )
  )
    return null;
  const card: DripCard = {
    ...toCard(ticket),
    ticketUid: uid,
    cupCount: decision.cupCount,
    isRebrew: true,
  };
  const interrupt = decision.interruptCurrent && ticket.status === "brewing";

  const baristas = board.baristas.map((barista): Barista => {
    let queue = barista.queue;
    let pastTickets = barista.pastTickets;
    if (interrupt && barista.id === sourceBayId) {
      queue = queue.filter((item) => item.ticketUid !== key);
      pastTickets = [
        ...pastTickets,
        {
          ...ticket,
          status: "completed",
          endTimeSec: nowSec,
          isInterrupted: true,
        },
      ];
    }
    if (barista === target) {
      const index = decision.insertIndex ?? queue.length;
      queue = [...queue.slice(0, index), toTicket(card), ...queue.slice(index)];
    }
    if (queue === barista.queue) return barista;
    return { ...barista, queue: scheduleQueue(queue, nowSec), pastTickets };
  });

  return {
    label: `${orderLabel(ticket)}の入れ直し`,
    board: {
      baristas,
      unassigned:
        decision.targetBayId === null
          ? [card, ...board.unassigned]
          : board.unassigned,
    },
  };
};
