import { type OrderEntity, jstDate } from "@cafeore/common";

export const QUARTER_MS = 15 * 60_000;
export interface AnalysisCup {
  id: string;
  product: string;
  ready: number | null;
  served: number | null;
  /** 過去年の注文単位の打刻を各杯に展開した参考値 */
  orderTiming: boolean;
}
export interface AnalysisOrder {
  id: string;
  number: number;
  created: number;
  cancelled: number | null;
  revenue: number;
  cups: AnalysisCup[];
  comments: { at: number; author: string; text: string }[];
}
const time = (date: Date | null | undefined) => {
  const value = date?.getTime();
  return value !== undefined && Number.isFinite(value) ? value : null;
};
export const liveAnalysisOrders = (
  orders: readonly OrderEntity[],
): AnalysisOrder[] =>
  orders.map((order) => ({
    id: order.id ?? String(order.orderId),
    number: order.orderId,
    created: order.createdAt.getTime(),
    cancelled: time(order.cancelledAt),
    revenue: order.billingAmount,
    cups: order.cups.map((cup) => ({
      id: cup.id,
      product: cup.item.name,
      ready: time(cup.readyAt),
      served: time(cup.servedAt),
      orderTiming: false,
    })),
    comments: order.comments.map((comment) => ({
      at: comment.createdAt.getTime(),
      author: comment.author,
      text: comment.text,
    })),
  }));

/** Type 7 の線形補間。中央値・四分位・百分位で同じ定義を使う。 */
export const quantile = (
  sorted: readonly number[],
  p: number,
): number | null => {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * p;
  const lo = Math.floor(position);
  return (
    sorted[lo] + (sorted[Math.ceil(position)] - sorted[lo]) * (position - lo)
  );
};
export const distribution = (values: readonly number[]) => {
  const sorted = values
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const iqr = q1 !== null && q3 !== null ? q3 - q1 : null;
  const low = iqr === null || q1 === null ? null : q1 - 1.5 * iqr;
  const high = iqr === null || q3 === null ? null : q3 + 1.5 * iqr;
  const inliers = sorted.filter(
    (v) => low !== null && high !== null && v >= low && v <= high,
  );
  const histogram = Array.from({ length: 9 }, (_, i) => ({
    label: i === 8 ? "40分以上" : `${i * 5}–${(i + 1) * 5}分`,
    count: sorted.filter((v) => v >= i * 5 && (i === 8 || v < (i + 1) * 5))
      .length,
  }));
  // 同値をまとめ、CDFの最後の点が必ず100%になるようにする。
  const cdf = sorted.flatMap((minutes, i) =>
    i === sorted.length - 1 || sorted[i + 1] !== minutes
      ? [{ minutes, percent: ((i + 1) / sorted.length) * 100 }]
      : [],
  );
  return {
    count: sorted.length,
    mean: sorted.length
      ? sorted.reduce((sum, v) => sum + v, 0) / sorted.length
      : null,
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    q1,
    q3,
    min: inliers[0] ?? null,
    max: inliers.at(-1) ?? null,
    outliers: sorted.filter(
      (v) => low !== null && high !== null && (v < low || v > high),
    ),
    histogram,
    cdf,
  };
};
export interface FlowBucket {
  at: number;
  received: number;
  served: number;
  cancelled: number;
  backlog: number;
  net: number;
  acceleration: number | null;
  complete: boolean;
}
export interface TimeWindow {
  start: number;
  end: number;
  now: number;
}
const minutesBetween = (
  end: number | null,
  start: number | null,
  now: number,
) =>
  end !== null && start !== null && end >= start && end < now
    ? (end - start) / 60_000
    : null;

/** [start,end) に受注したコホートと、その時間帯の流量を分けて集計する。 */
export const operationsReport = (
  input: readonly AnalysisOrder[],
  window: TimeWindow,
) => {
  const cutoff = Math.min(window.end, window.now);
  const orders = [
    ...new Map(input.map((order) => [order.id, order])).values(),
  ].filter((order) => order.created < cutoff && Number.isFinite(order.created));
  const isCancelled = (order: AnalysisOrder) =>
    order.cancelled !== null && order.cancelled < cutoff;
  const cohort = orders.filter(
    (o) => o.created >= window.start && o.created < window.end,
  );
  const active = cohort.filter((o) => !isCancelled(o));
  const events = new Map<
    number,
    { received: number; served: number; cancelled: number }
  >();
  const add = (
    at: number,
    key: "received" | "served" | "cancelled",
    count = 1,
  ) => {
    const bucket = Math.floor(at / QUARTER_MS) * QUARTER_MS;
    const value = events.get(bucket) ?? {
      received: 0,
      served: 0,
      cancelled: 0,
    };
    value[key] += count;
    events.set(bucket, value);
  };
  let openingBacklog = 0;
  let invalidTimes = 0;
  for (const order of orders) {
    add(order.created, "received", order.cups.length);
    for (const cup of order.cups) {
      const servedValid =
        cup.served !== null &&
        cup.served >= order.created &&
        cup.served < cutoff &&
        (order.cancelled === null || cup.served <= order.cancelled);
      if (servedValid && cup.served !== null) add(cup.served, "served");
      if (isCancelled(order) && order.cancelled !== null && !servedValid)
        add(order.cancelled, "cancelled");
      if (
        order.created < window.start &&
        (!servedValid || (cup.served !== null && cup.served >= window.start)) &&
        (order.cancelled === null || order.cancelled >= window.start)
      )
        openingBacklog++;
      if (
        (cup.ready !== null && cup.ready < order.created) ||
        (cup.served !== null &&
          (cup.served < order.created ||
            (cup.ready !== null && cup.served < cup.ready)))
      )
        invalidTimes++;
    }
  }
  const buckets: FlowBucket[] = [];
  let backlog = openingBacklog;
  let previousNet: number | null = null;
  for (let at = window.start; at < cutoff; at += QUARTER_MS) {
    const value = events.get(at) ?? { received: 0, served: 0, cancelled: 0 };
    const net = value.received - value.served - value.cancelled;
    backlog += net;
    const complete = at + QUARTER_MS <= cutoff;
    buckets.push({
      at,
      ...value,
      backlog,
      net,
      acceleration: complete && previousNet !== null ? net - previousNet : null,
      complete,
    });
    if (complete) previousNet = net;
  }
  const productMap = new Map<
    string,
    {
      received: number;
      pending: number;
      prep: number[];
      handoff: number[];
      total: number[];
    }
  >();
  const outlierCups: { orderNo: number; product: string; minutes: number }[] =
    [];
  let pending = 0;
  let censored = 0;
  let proxyCups = 0;
  for (const order of active) {
    for (const cup of order.cups) {
      const product = productMap.get(cup.product) ?? {
        received: 0,
        pending: 0,
        prep: [],
        handoff: [],
        total: [],
      };
      product.received++;
      if (cup.orderTiming) proxyCups++;
      const prep = minutesBetween(cup.ready, order.created, cutoff);
      const handoff = minutesBetween(cup.served, cup.ready, cutoff);
      const total = minutesBetween(cup.served, order.created, cutoff);
      if (prep !== null) product.prep.push(prep);
      if (handoff !== null) product.handoff.push(handoff);
      if (total !== null) {
        product.total.push(total);
        outlierCups.push({
          orderNo: order.number,
          product: cup.product,
          minutes: total,
        });
      } else {
        pending++;
        product.pending++;
        censored++;
      }
      productMap.set(cup.product, product);
    }
  }
  const products = [...productMap].map(([name, value]) => ({
    name,
    received: value.received,
    pending: value.pending,
    prep: distribution(value.prep),
    handoff: distribution(value.handoff),
    total: distribution(value.total),
  }));
  const total = distribution(outlierCups.map((cup) => cup.minutes));
  const completed = buckets.filter((b) => b.complete);
  const latest = completed.at(-1) ?? null;
  const longest = orders
    .filter((o) => !isCancelled(o))
    .flatMap((o) =>
      o.cups
        .filter(
          (c) =>
            c.served === null || c.served >= cutoff || c.served < o.created,
        )
        .map((c) => ({
          number: o.number,
          product: c.product,
          minutes: (cutoff - o.created) / 60_000,
        })),
    )
    .sort((a, b) => b.minutes - a.minutes);
  return {
    buckets,
    openingBacklog,
    latest,
    products,
    total,
    pending,
    censored,
    proxyCups,
    invalidTimes,
    received: cohort.reduce((n, o) => n + o.cups.length, 0),
    served: buckets.reduce((n, b) => n + b.served, 0),
    cancelledCups: buckets.reduce((n, b) => n + b.cancelled, 0),
    revenue: active.reduce((n, o) => n + o.revenue, 0),
    orderCount: active.length,
    cancelledOrders: cohort.length - active.length,
    backlog: buckets.at(-1)?.backlog ?? openingBacklog,
    longest,
    outlierCups: outlierCups
      .filter((c) => total.outliers.includes(c.minutes))
      .sort((a, b) => b.minutes - a.minutes),
    comments: cohort
      .flatMap((o) =>
        o.comments
          .filter((c) => c.at >= window.start && c.at < cutoff)
          .map((c) => ({ ...c, orderNo: o.number })),
      )
      .sort((a, b) => b.at - a.at),
  };
};

export const dayWindow = (date: string, now: number): TimeWindow => {
  const start = Date.parse(`${date}T00:00:00+09:00`);
  return { start, end: start + 86_400_000, now };
};
export const availableDays = (orders: readonly AnalysisOrder[], now: number) =>
  [...new Set([jstDate(now), ...orders.map((order) => jstDate(order.created))])]
    .sort()
    .reverse();
