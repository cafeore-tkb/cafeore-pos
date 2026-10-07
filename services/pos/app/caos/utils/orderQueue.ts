import { CHANGEOVER_SEC } from "@cafeore/common";
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
