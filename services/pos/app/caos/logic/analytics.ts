import type { PracticeDataOrder } from "@cafeore/common";
import { type CardLooks, type CardSplit, orderLabel, totalCups } from "./cards";
import { type Lane, laneActive } from "./lanes";

// 実績（補助のタブ）の集計。分けた注文の仕上がりの差（Δ）・ドリッパーごとの量・実データテストの売上

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
const splitResults = (lanes: Lane[], looks: CardLooks) => {
  const groups = new Map<
    string,
    { split: CardSplit; bayId: number; finishedMs: number }[]
  >();
  for (const lane of lanes) {
    for (const card of lane.done) {
      const split = looks.get(card.key)?.split;
      if (!split || !card.finishedAt) continue;
      const key = orderLabel(card);
      groups.set(key, [
        ...(groups.get(key) ?? []),
        { split, bayId: lane.id, finishedMs: card.finishedAt.getTime() },
      ]);
    }
  }
  return Array.from(groups, ([orderId, parts]) => {
    const expectedParts = Math.max(...parts.map((part) => part.split.total));
    const finished = parts.map((part) => part.finishedMs);
    const firstFinishedMs = Math.min(...finished);
    const lastFinishedMs = Math.max(...finished);
    return {
      orderId,
      expectedParts,
      isComplete: parts.length >= expectedParts,
      totalCups: Math.max(...parts.map((part) => part.split.cups)),
      deltaSec: Math.round((lastFinishedMs - firstFinishedMs) / 1000),
      firstFinishedMs,
      lastFinishedMs,
      bayIds: [...new Set(parts.map((part) => part.bayId))].sort(
        (a, b) => a - b,
      ),
    };
  })
    .filter((result) => result.isComplete)
    .sort((a, b) => b.lastFinishedMs - a.lastFinishedMs);
};

// 分けた注文のうち、まだドリッパーに残っている（抽出中・待機の）カードの数とドリッパー
const pendingSplitOrders = (lanes: Lane[], looks: CardLooks) => {
  const groups = new Map<
    string,
    { expected: number; assigned: number; bays: Set<number> }
  >();
  for (const lane of lanes) {
    for (const card of laneActive(lane)) {
      const split = looks.get(card.key)?.split;
      if (!split) continue;
      const key = orderLabel(card);
      const current = groups.get(key) ?? {
        expected: split.total,
        assigned: 0,
        bays: new Set<number>(),
      };
      current.expected = Math.max(current.expected, split.total);
      current.assigned += 1;
      current.bays.add(lane.id);
      groups.set(key, current);
    }
  }
  return Array.from(groups, ([orderId, value]) => ({
    orderId,
    ...value,
    bays: [...value.bays].sort((a, b) => a - b),
  }));
};

// ドリッパーごとの淹れた杯数・回数・平均の抽出時間
const baristaResults = (lanes: Lane[]) =>
  lanes.map((lane) => {
    const durations = lane.done.flatMap((card) =>
      card.startedAt && card.finishedAt
        ? [
            Math.max(
              0,
              (card.finishedAt.getTime() - card.startedAt.getTime()) / 1000,
            ),
          ]
        : [],
    );
    const averageSec = average(durations);
    return {
      bayId: lane.id,
      cups: totalCups(lane.done),
      drips: lane.done.length,
      averageSec: averageSec === null ? null : Math.round(averageSec),
    };
  });

// 実データテストの売上（10 分ごとの注文・商品の順位・種類の内訳・注文から準備完了までの平均）
const BUCKET_MS = 600_000;
const salesAnalysis = (orders: PracticeDataOrder[]) => {
  if (orders.length === 0) return null;
  const menuMap = new Map<string, number>();
  const typeMap = new Map<string, number>();
  const bucketMap = new Map<number, { orders: number; sales: number }>();
  const leadTimes: number[] = [];
  let cups = 0;
  for (const order of orders) {
    const createdMs = new Date(order.createdAt).getTime();
    const bucket = Math.floor(createdMs / BUCKET_MS) * BUCKET_MS;
    const bucketValue = bucketMap.get(bucket) ?? { orders: 0, sales: 0 };
    bucketValue.orders += 1;
    bucketValue.sales += order.billingAmount;
    for (const item of order.items) {
      if (item.type === "others") continue;
      cups += 1;
      menuMap.set(item.name, (menuMap.get(item.name) ?? 0) + 1);
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
    menuRanking: Array.from(menuMap, ([name, cups]) => ({ name, cups }))
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
  lanes: Lane[],
  looks: CardLooks,
  salesOrders: PracticeDataOrder[],
) => {
  const splits = splitResults(lanes, looks);
  const averageDelta = average(splits.map((result) => result.deltaSec));
  return {
    sales: salesAnalysis(salesOrders),
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
    baristas: baristaResults(lanes),
    pendingSplits: pendingSplitOrders(lanes, looks),
  };
};
