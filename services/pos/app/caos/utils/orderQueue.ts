import {
  CAOS_CHANGEOVER_SEC,
  CAOS_FIRST_START_DELAY_SEC,
  CAOS_MAX_CUPS,
  CAOS_SOON_SEC,
} from "@cafeore/common";
import type { Barista, DripCard, OrderTicket } from "../types";

/** 注文番号の表示（「#152」、統合したカードは「#152+#160」）。選んだ注文を指すキーにも使う（読み戻さない） */
export const orderLabel = (card: { orderNos: readonly number[] }) =>
  card.orderNos.map((no) => `#${no.toString().padStart(3, "0")}`).join("+");

/** カードを注文ごとにまとめる（並びはそのまま）。キーは orderLabel */
export const groupByOrder = <T extends DripCard>(cards: readonly T[]) => {
  const groups = new Map<string, T[]>();
  for (const card of cards) {
    const key = orderLabel(card);
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  return groups;
};

/** 注文番号・注文の中の順に並べる */
export const compareCards = (a: DripCard, b: DripCard) =>
  a.orderNos[0] - b.orderNos[0] ||
  a.itemIndex - b.itemIndex ||
  a.ticketUid.localeCompare(b.ticketUid);

// 1杯同士で、統合の相手を決めるキー（mergeKey）が同じものだけを、2杯の同時抽出へ統合できる。
// 注文から組み立てたカードの mergeKey は @cafeore/common の caosMergeKey（canMergeCards が比べるもの。商品と指名）。
export const canMergeDripUnits = (first: DripCard, second: DripCard) =>
  first.ticketUid !== second.ticketUid &&
  first.cupCount === 1 &&
  second.cupCount === 1 &&
  first.mergeKey === second.mergeKey;

// arrangeQueue は実データテスト（手元の盤面）の並べ直し。CaOS8（練習の盤面）で作り直すので、
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
    .sort(compareCards);
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

// ドリッパーが待機まで淹れ終えるまでの秒（入れ替えの時間を含む）
const queueWaitSeconds = (queue: OrderTicket[]) =>
  queue.reduce(
    (sum, ticket, index) =>
      sum +
      (index === 0
        ? (ticket.timeRemainingSec ?? ticket.totalDurationSec)
        : ticket.totalDurationSec + CAOS_CHANGEOVER_SEC),
    0,
  );

// 次に空くドリッパー（空くまでの秒の短い順に 3 つ）。管制盤 A・C の「次に空く」
export const nextAvailableBays = (baristas: Barista[]) =>
  baristas
    .map((barista) => ({
      bayId: barista.id,
      seconds: queueWaitSeconds(barista.queue),
      isStandby: barista.queue.length === 0,
    }))
    .sort((a, b) => a.seconds - b.seconds || a.bayId - b.bayId)
    .slice(0, 3);
export type NextAvailable = ReturnType<typeof nextAvailableBays>;

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

// 抽出中のカードの残りが CAOS_SOON_SEC 以下（「まもなく」）
export const isSoon = (barista: Barista, nowSec: number) =>
  barista.queue[0]?.status === "brewing" &&
  activeRemainingSec(barista, nowSec) <= CAOS_SOON_SEC;

// 注文のカードを最大杯数（CAOS_MAX_CUPS）ずつに分け、注文の中の並び・カードの数・注文の杯数を付ける（実データテスト）
type UnsplitOrder = Omit<
  DripCard,
  "itemIndex" | "totalItemsInOrder" | "totalOrderCups"
>;
export const splitIntoDripUnits = (orders: UnsplitOrder[]): DripCard[] => {
  const totalOrderCups = totalCups(orders);
  const units = orders.flatMap((order) => {
    const parts: UnsplitOrder[] = [];
    let remaining = order.cupCount;
    let part = 1;
    while (remaining > 0) {
      const cups = Math.min(CAOS_MAX_CUPS, remaining);
      parts.push({
        ...order,
        ticketUid: `${order.ticketUid}-part${part}`,
        cupCount: cups,
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
