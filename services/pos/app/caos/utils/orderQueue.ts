import {
  CAOS_CHANGEOVER_SEC,
  CAOS_FIRST_START_DELAY_SEC,
  CAOS_MAX_CUPS,
} from "@cafeore/common";
import type { Barista, OrderTicket, UnassignedOrder } from "../types";

export const ticketKey = (ticket: OrderTicket) =>
  ticket.ticketUid || `${ticket.id}-${ticket.itemIndex || 1}`;

// 1杯同士で、統合の相手を決めるキー（mergeKey）が同じものだけを、2杯の同時抽出へ統合できる。
// 注文から組み立てたカードの mergeKey は @cafeore/common の caosMergeKey（canMergeCards が比べるもの。商品と指名）。
export const canMergeDripUnits = (
  first: UnassignedOrder,
  second: UnassignedOrder,
) =>
  (first.ticketUid || first.id) !== (second.ticketUid || second.id) &&
  first.cupCount === 1 &&
  second.cupCount === 1 &&
  first.mergeKey !== undefined &&
  first.mergeKey === second.mergeKey;

export const orderNumber = (id: string) =>
  Number(id.match(/\d+/)?.[0]) || Number.MAX_SAFE_INTEGER;

const compareQueueOrder = (a: OrderTicket, b: OrderTicket) =>
  orderNumber(a.id) - orderNumber(b.id) ||
  (a.itemIndex || 0) - (b.itemIndex || 0) ||
  (a.ticketUid || "").localeCompare(b.ticketUid || "");

// arrangeQueue は実データテスト（手元の盤面）の並べ直し。CaOS9（練習の盤面）で作り直すので、
// 定数だけ共通のもの（@cafeore/common）にしてある。普段の盤面の予定時刻は planCaosLane で決める（live/board.ts）
export const arrangeQueue = (
  queue: OrderTicket[],
  nowSec: number,
  activateFirst = false,
) => {
  const existingActive = !activateFirst
    ? queue.find((ticket) => ticket.status === "brewing")
    : undefined;
  const scheduled = queue
    .filter((ticket) => ticket !== existingActive)
    .map((ticket) => ({ ...ticket, status: "scheduled" as const }))
    .sort(compareQueueOrder);
  const ordered = existingActive ? [existingActive, ...scheduled] : scheduled;
  if (ordered.length === 0) return ordered;

  const shouldActivateFirst = activateFirst || !existingActive;
  const first = shouldActivateFirst
    ? {
        ...ordered[0],
        status: "brewing" as const,
        startTimeSec: nowSec,
        timeRemainingSec: ordered[0].totalDurationSec,
      }
    : existingActive;
  if (!first) return [];
  const result: OrderTicket[] = [first];
  const firstEnd =
    first.status === "brewing"
      ? Math.max(
          nowSec,
          (first.startTimeSec ?? nowSec) + first.totalDurationSec,
        )
      : (first.startTimeSec ?? nowSec + CAOS_FIRST_START_DELAY_SEC) +
        first.totalDurationSec;
  let cursor = firstEnd;

  for (const ticket of ordered.slice(1)) {
    const startTimeSec = cursor + CAOS_CHANGEOVER_SEC;
    result.push({
      ...ticket,
      status: "scheduled",
      startTimeSec,
      timeRemainingSec: undefined,
    });
    cursor = startTimeSec + ticket.totalDurationSec;
  }
  return result;
};

// Seconds until the dripper has finished everything already queued, using the
// same changeover gap as the scheduler.
export const queueWaitSeconds = (queue: OrderTicket[]) =>
  queue.reduce(
    (sum, ticket, index) =>
      sum +
      (index === 0
        ? (ticket.timeRemainingSec ?? ticket.totalDurationSec)
        : ticket.totalDurationSec + CAOS_CHANGEOVER_SEC),
    0,
  );

// 次に空くドリッパー（空くまでの秒の短い順に 3 つ）
export const nextAvailableBays = (baristas: Barista[]) =>
  baristas
    .map((barista) => ({
      bayNumber: barista.bayNumber,
      seconds: queueWaitSeconds(barista.queue),
      isStandby: barista.queue.length === 0,
    }))
    .sort((a, b) => a.seconds - b.seconds || a.bayNumber - b.bayNumber)
    .slice(0, 3);

// カードの杯数の合計
export const totalCups = (cards: { cupCount: number }[]) =>
  cards.reduce((sum, card) => sum + card.cupCount, 0);

// ドリッパーの先頭のカードの残り（秒）。カードが無ければ 0
export const activeRemainingSec = (barista: Barista, nowSec: number) => {
  const current = barista.queue[0];
  if (!current) return 0;
  if (current.timeRemainingSec !== undefined) return current.timeRemainingSec;
  if (current.endTimeSec !== undefined)
    return Math.max(0, current.endTimeSec - nowSec);
  return current.totalDurationSec;
};

export const splitIntoDripUnits = (orders: UnassignedOrder[]) => {
  const totalOrderCups = orders.reduce((sum, order) => sum + order.cupCount, 0);
  const units = orders.flatMap((order) => {
    const parts: UnassignedOrder[] = [];
    let remaining = order.cupCount;
    let part = 1;
    while (remaining > 0) {
      const cups = Math.min(CAOS_MAX_CUPS, remaining);
      parts.push({
        ...order,
        ticketUid: `${order.ticketUid || order.id.replace("#", "")}-part${part}`,
        cupCount: cups,
        badgeTag: `${cups}杯 ${order.badgeTag.replace(/^\d+杯\s*/, "")}`,
      });
      remaining -= cups;
      part += 1;
    }
    return parts;
  });
  return units.map((unit, index) => ({
    ...unit,
    itemIndex: index + 1,
    totalItemsInOrder: units.length,
    totalOrderCups,
  }));
};
