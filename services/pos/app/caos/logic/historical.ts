import type { DripCard, HistoricalOrder, TestPlaySession } from "../types";
import { splitIntoDripUnits } from "./cards";

// 実データテスト（2025年の注文。商品 ID が無い）のカード。cafeore-pos の注文のカードには使わない。
// 過去の注文には商品 ID が無いので、商品の名前でまとめ方（統合できる相手）を決める。
// 実データテストは作り直す予定（練習の盤面）なので、それまでここだけに残す。
const historicalGroupOf = (name: string, type: string) => {
  if (type === "ice") return "ICE";
  if (type === "iceOre" || type === "milk") return "MILK";
  if (name.includes("俺")) return "ORE";
  if (name.includes("縁")) return "CHAMP";
  if (name.includes("キリマンジャロ")) return "TNZ";
  if (name.includes("トラジャ")) return "BRA";
  if (name.includes("ピンク")) return "KEN";
  return "SP";
};

const historicalOrderToDripUnits = (order: HistoricalOrder): DripCard[] => {
  const grouped = new Map<string, { names: string[]; count: number }>();
  for (const item of order.items) {
    // Plain iced milk is served without dripping, so it never enters CaOS's drip queue.
    if (
      item.type === "others" ||
      item.type === "milk" ||
      item.name.includes("アイスミルク")
    )
      continue;
    const group = historicalGroupOf(item.name, item.type);
    const current = grouped.get(group) ?? { names: [], count: 0 };
    current.count += 1;
    if (!current.names.includes(item.name)) current.names.push(item.name);
    grouped.set(group, current);
  }
  return splitIntoDripUnits(
    Array.from(grouped, ([group, { names, count }], index) => ({
      ticketUid: `history-${order.orderId}-${group}-${index}`,
      orderNos: [order.orderId],
      beanName: names.join("・"),
      cupCount: count,
      mergeKey: `history-${group}`,
    })),
  );
};

const createdMs = (order: HistoricalOrder) =>
  new Date(order.createdAt).getTime();

/** 時刻（nowMs）までに届いた注文（cursor から先）のカードと、次の cursor。orders は時刻の順 */
export const historicalArrivals = (
  orders: HistoricalOrder[],
  cursor: number,
  nowMs: number,
) => {
  let next = cursor;
  while (next < orders.length && createdMs(orders[next]) <= nowMs) next += 1;
  return {
    cards: orders.slice(cursor, next).flatMap(historicalOrderToDripUnits),
    cursor: next,
  };
};

/** startMs から endMs までの注文を時刻の順に */
export const ordersInPeriod = (
  orders: HistoricalOrder[],
  startMs: number,
  endMs: number,
) =>
  orders
    .filter((order) => createdMs(order) >= startMs && createdMs(order) < endMs)
    .sort((a, b) => createdMs(a) - createdMs(b));

/** 実績に出す、テストの時刻までに届いた注文と、その時間帯（テストをしていなければ空） */
export const testPlayAnalytics = (session: TestPlaySession | null) => ({
  salesOrders: session
    ? session.orders.filter((order) => createdMs(order) <= session.currentMs)
    : [],
  periodStartMs: session?.startMs,
  periodEndMs: session ? Math.min(session.currentMs, session.endMs) : undefined,
});

/** テストの残り（「12分」） */
export const testPlayRemainingLabel = (session: TestPlaySession) =>
  `${Math.max(0, Math.ceil((session.endMs - session.currentMs) / 60_000))}分`;

const SLOT_MS = 30 * 60_000;

/**
 * テストを始められる時刻（30 分ごと）。注文のある日ごとに、最初の注文の 30 分区切りから、
 * 時間帯（durationMinutes 分）に注文がある時刻だけ
 */
export const testPlaySlots = (
  orders: HistoricalOrder[],
  durationMinutes: number,
) => {
  const durationMs = durationMinutes * 60_000;
  const days = new Map<string, number[]>();
  for (const order of orders) {
    const date = new Date(order.createdAt);
    const dayKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    days.set(dayKey, [...(days.get(dayKey) ?? []), date.getTime()]);
  }
  return Array.from(days.values())
    .sort((a, b) => Math.min(...a) - Math.min(...b))
    .flatMap((timestamps) => {
      const first = new Date(Math.min(...timestamps));
      first.setMinutes(first.getMinutes() < 30 ? 0 : 30, 0, 0);
      const last = Math.max(...timestamps);
      const slots: number[] = [];
      for (
        let cursor = first.getTime();
        cursor + durationMs <= last + SLOT_MS;
        cursor += SLOT_MS
      ) {
        if (ordersInPeriod(orders, cursor, cursor + durationMs).length > 0)
          slots.push(cursor);
      }
      return slots;
    });
};
