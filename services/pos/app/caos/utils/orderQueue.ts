import { CHANGEOVER_SEC, FIRST_START_DELAY_SEC } from "@cafeore/common";
import type { Barista, OrderTicket, UnassignedOrder } from "../types";

export const ticketKey = (ticket: OrderTicket) =>
  ticket.ticketUid || `${ticket.id}-${ticket.itemIndex || 1}`;

// 同じメニュー・同じ指名の1杯同士だけを、2杯の同時抽出へ統合できる（入れ直しは除く）。
export const canMergeDripUnits = (
  first: UnassignedOrder,
  second: UnassignedOrder,
) =>
  (first.ticketUid || first.id) !== (second.ticketUid || second.id) &&
  !first.isRebrew &&
  !second.isRebrew &&
  first.cupCount === 1 &&
  second.cupCount === 1 &&
  first.beanCode === second.beanCode &&
  // 盤面のカードは商品の ID を持つ。API は同じ商品どうししか統合しないので、候補もそれに揃える
  (first.itemKey === undefined ||
    second.itemKey === undefined ||
    first.itemKey === second.itemKey) &&
  first.preferredBaristaId === second.preferredBaristaId;

export const orderNumber = (id: string) =>
  Number(id.match(/\d+/)?.[0]) || Number.MAX_SAFE_INTEGER;

const compareQueueOrder = (a: OrderTicket, b: OrderTicket) =>
  orderNumber(a.id) - orderNumber(b.id) ||
  (a.itemIndex || 0) - (b.itemIndex || 0) ||
  (a.ticketUid || "").localeCompare(b.ticketUid || "");

// arrangeQueue・reanchorQueueInOrder は実データテスト（手元の盤面）の並べ直し。作業計画 K7 で作り直すので、
// 定数だけ共通のもの（@cafeore/common の caosTiming）にしてある。普段の盤面の予定時刻は planLane で決める（live/drips.ts）
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
      : (first.startTimeSec ?? nowSec + FIRST_START_DELAY_SEC) +
        first.totalDurationSec;
  let cursor = firstEnd;

  for (const ticket of ordered.slice(1)) {
    const startTimeSec = cursor + CHANGEOVER_SEC;
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

export const reanchorQueueInOrder = (queue: OrderTicket[], nowSec: number) => {
  if (queue.length === 0) return queue;
  const firstWasBrewing = queue[0].status === "brewing";
  const first: OrderTicket = firstWasBrewing
    ? { ...queue[0] }
    : {
        ...queue[0],
        status: "brewing",
        startTimeSec: nowSec,
        timeRemainingSec: queue[0].totalDurationSec,
      };
  const result = [first];
  let cursor = Math.max(
    nowSec,
    (first.startTimeSec ?? nowSec) + first.totalDurationSec,
  );
  queue.slice(1).forEach((ticket) => {
    const startTimeSec = cursor + CHANGEOVER_SEC;
    result.push({
      ...ticket,
      status: "scheduled",
      startTimeSec,
      timeRemainingSec: undefined,
    });
    cursor = startTimeSec + ticket.totalDurationSec;
  });
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
        : ticket.totalDurationSec + CHANGEOVER_SEC),
    0,
  );

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
      const cups = Math.min(2, remaining);
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
