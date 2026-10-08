import type { DripCard, HistoricalOrder } from "../types";
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

/** 実績に出す、テストの時刻（currentMs）までに届いた注文 */
export const ordersSoFar = (session: {
  orders: HistoricalOrder[];
  currentMs: number;
}) => session.orders.filter((order) => createdMs(order) <= session.currentMs);
