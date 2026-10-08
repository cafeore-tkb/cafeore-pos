import type { OrderTicket, UnassignedOrder } from "../types";

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

// Seconds until the dripper has finished everything already queued, using the
// same 15-second changeover gap as the scheduler.
export const queueWaitSeconds = (queue: OrderTicket[]) =>
  queue.reduce(
    (sum, ticket, index) =>
      sum +
      (index === 0
        ? (ticket.timeRemainingSec ?? ticket.totalDurationSec)
        : ticket.totalDurationSec + 15),
    0,
  );
