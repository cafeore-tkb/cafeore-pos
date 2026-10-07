import type { OrderTicket, UnassignedOrder } from "../types";

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
  first.preferredBaristaId === second.preferredBaristaId;

export const orderNumber = (id: string) =>
  Number(id.match(/\d+/)?.[0]) || Number.MAX_SAFE_INTEGER;

const compareQueueOrder = (a: OrderTicket, b: OrderTicket) =>
  orderNumber(a.id) - orderNumber(b.id) ||
  (a.itemIndex || 0) - (b.itemIndex || 0) ||
  (a.ticketUid || "").localeCompare(b.ticketUid || "");

export const arrangeQueue = (
  queue: OrderTicket[],
  coefficient: number,
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
        timeRemainingSec: Math.round(ordered[0].totalDurationSec * coefficient),
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
      : (first.startTimeSec ?? nowSec + 10) + first.totalDurationSec;
  let cursor = firstEnd;

  for (const ticket of ordered.slice(1)) {
    const startTimeSec = cursor + 15;
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

export const reanchorQueueInOrder = (
  queue: OrderTicket[],
  coefficient: number,
  nowSec: number,
) => {
  if (queue.length === 0) return queue;
  const firstWasBrewing = queue[0].status === "brewing";
  const first: OrderTicket = firstWasBrewing
    ? { ...queue[0] }
    : {
        ...queue[0],
        status: "brewing",
        startTimeSec: nowSec,
        timeRemainingSec: Math.round(queue[0].totalDurationSec * coefficient),
      };
  const result = [first];
  let cursor = Math.max(
    nowSec,
    (first.startTimeSec ?? nowSec) + first.totalDurationSec,
  );
  queue.slice(1).forEach((ticket) => {
    const startTimeSec = cursor + 15;
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
// same 15-second changeover gap as the scheduler.
export const queueWaitSeconds = (queue: OrderTicket[], coefficient: number) =>
  queue.reduce(
    (sum, ticket, index) =>
      sum +
      (index === 0
        ? (ticket.timeRemainingSec ??
          Math.round(ticket.totalDurationSec * coefficient))
        : ticket.totalDurationSec + 15),
    0,
  );

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
