import { CHANGEOVER_SEC } from "@cafeore/common";
import type { Barista, OrderTicket, UnassignedOrder } from "../types";

// 統合の候補：同じ商品・同じ指名（mergeKey）の 1 杯どうし。
// 書き込みは mergeWrites が @cafeore/common の canMergeCards で確かめる（サーバーも同じ決まり）ので、ここは候補を出すだけ。
export const canMergeDripUnits = (
  first: UnassignedOrder,
  second: UnassignedOrder,
) =>
  first.ticketUid !== second.ticketUid &&
  first.cupCount === 1 &&
  second.cupCount === 1 &&
  first.mergeKey === second.mergeKey;

export const orderNumber = (id: string) =>
  Number(id.match(/\d+/)?.[0]) || Number.MAX_SAFE_INTEGER;

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
