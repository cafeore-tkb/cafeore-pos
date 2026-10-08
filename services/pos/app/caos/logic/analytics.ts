import type { Barista, HistoricalOrder, OrderTicket } from "../types";
import { orderLabel, totalCups } from "./cards";

// 実績（補助のタブ）の集計。分けた注文の仕上がりの差（Δ）・入れ直し・ドリッパーごとの量・実データテストの売上

/** 仕上がりの差（Δ）の目標と、要確認になる秒 */
const DELTA_GOOD_SEC = 15;
const DELTA_OK_SEC = 30;

/** 仕上がりの差の評価（良好・許容・要確認） */
export const deltaGrade = (deltaSec: number) => {
  if (deltaSec <= DELTA_GOOD_SEC) return "good";
  if (deltaSec <= DELTA_OK_SEC) return "ok";
  return "bad";
};
export type DeltaGrade = ReturnType<typeof deltaGrade>;

const average = (values: number[]) =>
  values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;

// 分けた注文のうち、全部のカードを淹れ終えた注文の仕上がりの差（最初と最後のカードの終わりの差）
const splitResults = (baristas: Barista[]) => {
  const groups = new Map<
    string,
    { ticket: OrderTicket; bayId: number; finishedAt: number }[]
  >();
  for (const barista of baristas) {
    for (const ticket of barista.pastTickets) {
      if (
        ticket.isInterrupted ||
        ticket.isRebrew ||
        ticket.totalItemsInOrder <= 1 ||
        ticket.endTimeSec === undefined
      )
        continue;
      const key = orderLabel(ticket);
      groups.set(key, [
        ...(groups.get(key) ?? []),
        { ticket, bayId: barista.id, finishedAt: ticket.endTimeSec },
      ]);
    }
  }
  return Array.from(groups, ([orderId, parts]) => {
    const expectedParts = Math.max(
      ...parts.map((part) => part.ticket.totalItemsInOrder),
    );
    const finished = parts.map((part) => part.finishedAt);
    const firstFinishedAt = Math.min(...finished);
    const lastFinishedAt = Math.max(...finished);
    return {
      orderId,
      expectedParts,
      isComplete: parts.length >= expectedParts,
      totalCups: Math.max(...parts.map((part) => part.ticket.totalOrderCups)),
      deltaSec: lastFinishedAt - firstFinishedAt,
      firstFinishedAt,
      lastFinishedAt,
      bayIds: [...new Set(parts.map((part) => part.bayId))].sort(
        (a, b) => a - b,
      ),
    };
  })
    .filter((result) => result.isComplete)
    .sort((a, b) => b.lastFinishedAt - a.lastFinishedAt);
};

// 分けた注文のうち、まだドリッパーに残っているカードの数とドリッパー
const pendingSplitOrders = (baristas: Barista[]) => {
  const groups = new Map<
    string,
    { expected: number; assigned: number; bays: Set<number> }
  >();
  for (const barista of baristas) {
    for (const ticket of barista.queue) {
      if (ticket.totalItemsInOrder <= 1) continue;
      const key = orderLabel(ticket);
      const current = groups.get(key) ?? {
        expected: ticket.totalItemsInOrder,
        assigned: 0,
        bays: new Set<number>(),
      };
      current.expected = Math.max(current.expected, ticket.totalItemsInOrder);
      current.assigned += 1;
      current.bays.add(barista.id);
      groups.set(key, current);
    }
  }
  return Array.from(groups, ([orderId, value]) => ({
    orderId,
    ...value,
    bays: [...value.bays].sort((a, b) => a - b),
  }));
};

// 入れ直し（終えた入れ直しと、止めたカード）
const rebrewSummary = (baristas: Barista[]) => {
  const history = baristas.flatMap((barista) => barista.pastTickets);
  const rebrews = history.filter(
    (ticket) => ticket.isRebrew && !ticket.isInterrupted,
  );
  // 入れ直しで余分に使った豆は CaOS では数えない（豆の在庫は POS の在庫で見る）
  return {
    rebrewCount: rebrews.length,
    rebrewCups: totalCups(rebrews),
    interruptedCount: history.filter((ticket) => ticket.isInterrupted).length,
  };
};

// ドリッパーごとの淹れた杯数・回数・平均の抽出時間
const baristaResults = (baristas: Barista[]) =>
  baristas.map((barista) => {
    const durations = barista.pastTickets.flatMap((ticket) =>
      ticket.startTimeSec !== undefined && ticket.endTimeSec !== undefined
        ? [Math.max(0, ticket.endTimeSec - ticket.startTimeSec)]
        : [],
    );
    const averageSec = average(durations);
    return {
      bayId: barista.id,
      cups: totalCups(barista.pastTickets),
      drips: barista.pastTickets.length,
      averageSec: averageSec === null ? null : Math.round(averageSec),
    };
  });

// 実データテストの売上（10 分ごとの注文・商品の順位・種類の内訳・注文から準備完了までの平均）
const BUCKET_MS = 600_000;
const salesAnalysis = (orders: HistoricalOrder[]) => {
  if (orders.length === 0) return null;
  const menuMap = new Map<string, { cups: number; sales: number }>();
  const typeMap = new Map<string, number>();
  const bucketMap = new Map<
    number,
    { orders: number; sales: number; cups: number }
  >();
  const leadTimes: number[] = [];
  let cups = 0;
  for (const order of orders) {
    const createdMs = new Date(order.createdAt).getTime();
    const bucket = Math.floor(createdMs / BUCKET_MS) * BUCKET_MS;
    const bucketValue = bucketMap.get(bucket) ?? {
      orders: 0,
      sales: 0,
      cups: 0,
    };
    bucketValue.orders += 1;
    bucketValue.sales += order.billingAmount;
    for (const item of order.items) {
      if (item.type === "others") continue;
      cups += 1;
      bucketValue.cups += 1;
      const menu = menuMap.get(item.name) ?? { cups: 0, sales: 0 };
      menu.cups += 1;
      menu.sales += item.price;
      menuMap.set(item.name, menu);
      typeMap.set(item.type, (typeMap.get(item.type) ?? 0) + 1);
    }
    bucketMap.set(bucket, bucketValue);
    if (order.readyAt)
      leadTimes.push((new Date(order.readyAt).getTime() - createdMs) / 60_000);
  }
  const buckets = Array.from(bucketMap, ([time, value]) => ({
    time,
    ...value,
  })).sort((a, b) => a.time - b.time);
  const revenue = orders.reduce((sum, order) => sum + order.billingAmount, 0);
  return {
    revenue,
    orderCount: orders.length,
    cups,
    averageOrder: Math.round(revenue / orders.length),
    averageLeadMinutes: average(leadTimes),
    menuRanking: Array.from(menuMap, ([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.cups - a.cups)
      .slice(0, 8),
    typeMix: Array.from(typeMap, ([type, count]) => ({ type, count })).sort(
      (a, b) => b.count - a.count,
    ),
    buckets,
    maxBucketOrders: Math.max(...buckets.map((item) => item.orders), 1),
    peak: [...buckets].sort(
      (a, b) => b.orders - a.orders || b.sales - a.sales,
    )[0],
  };
};

/** 実績のパネルに出すもの */
export const analyticsReport = (
  baristas: Barista[],
  salesOrders: HistoricalOrder[],
) => {
  const splits = splitResults(baristas);
  const averageDelta = average(splits.map((result) => result.deltaSec));
  return {
    sales: salesAnalysis(salesOrders),
    rebrew: rebrewSummary(baristas),
    splits,
    averageDelta: averageDelta === null ? null : Math.round(averageDelta),
    within15Rate: splits.length
      ? Math.round(
          (splits.filter((result) => deltaGrade(result.deltaSec) === "good")
            .length /
            splits.length) *
            100,
        )
      : null,
    maxDelta: splits.length
      ? Math.max(...splits.map((result) => result.deltaSec))
      : null,
    sameLaneCount: splits.filter((result) => result.bayIds.length === 1).length,
    baristas: baristaResults(baristas),
    pendingSplits: pendingSplitOrders(baristas),
  };
};
