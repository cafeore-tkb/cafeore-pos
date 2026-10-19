import { type OrderEntity, jstDate } from "@cafeore/common";
import { STACK_MODEL, predictReadyMinutes } from "../readyTimeEstimate";
import { type BucketMinutes, type TimeWindow, quantile } from "./operations";
import { type StackFit, fitStackModel, predictWithFit } from "./stackModelFit";

/** 注文の写し。指名とコメントは写さない（FR-018） */
export interface StackOrder {
  id: string;
  number: number;
  created: number;
  ready: number | null;
  cancelled: number | null;
  drinkCups: number;
  /** 営業日（JST） */
  day: string;
}

/** 当てはめ用の注文観測。stack は受付の瞬間の値で、時点に依らない */
export interface StackObservation {
  id: string;
  number: number;
  created: number;
  ready: number | null;
  cancelled: number | null;
  drinkCups: number;
  stack: number;
  /** ready < created の壊れた記録 */
  brokenTime: boolean;
}

export interface StackInput {
  observations: StackObservation[];
  otherDays: StackOrder[];
}

export interface FitCounts {
  fitted: number;
  pending: number;
  cancelled: number;
  broken: number;
  latestTimestamp: number | null;
}

export interface NowState {
  asOf: number;
  live: boolean;
  stack: number;
  pendingOrders: number;
  oldestWaitMinutes: number | null;
  predictedFit: number | null;
  predictedFixed: number;
  extrapolated: boolean;
  otherDayPending: number;
}

export interface ScatterPoint {
  number: number;
  stack: number;
  minutes: number;
  predictedFit: number | null;
  predictedFixed: number;
  clipped: boolean;
}

export interface CurvePoint {
  stack: number;
  fit: number | null;
  fixed: number;
}

export interface AccuracyRow {
  method: "fit" | "fixed" | "mean";
  n: number;
  meanResidual: number | null;
  mae: number | null;
  medianAbsError: number | null;
}

export interface StackBin {
  lo: number;
  hi: number;
  n: number;
  p10: number | null;
  median: number | null;
  p90: number | null;
  predictedFit: number | null;
  predictedFixed: number;
}

export interface TrendPoint {
  asOf: number;
  partial: boolean;
  nObs: number;
  a1: number | null;
  c1: number | null;
  b: number | null;
  reason: "insufficient" | "no-convergence" | null;
}

export type StackWarning =
  | { kind: "a1-out-of-range"; a1: number; stackMin: number; stackMax: number }
  | { kind: "non-positive-slope"; b: number }
  | { kind: "extrapolation"; stack: number; stackMax: number }
  | { kind: "other-day-pending"; count: number };

export interface StackModelView {
  asOf: number;
  live: boolean;
  fit: StackFit;
  fixed: typeof STACK_MODEL;
  counts: FitCounts;
  now: NowState;
  points: ScatterPoint[];
  curve: CurvePoint[];
  yMax: number;
  clippedCount: number;
  /** 常に "fit"・"fixed"・"mean" の 3 行 */
  accuracy: AccuracyRow[];
  bins: StackBin[];
  warnings: StackWarning[];
}

const time = (date: Date | null | undefined) => {
  const value = date?.getTime();
  return value !== undefined && Number.isFinite(value) ? value : null;
};

/** OrderEntity から必要な列だけを写す。指名・コメントは読まない（FR-018） */
export const stackOrders = (orders: readonly OrderEntity[]): StackOrder[] => {
  const mapped = orders.flatMap((order): [string, StackOrder][] => {
    const created = time(order.createdAt);
    if (created === null) return [];
    const id = order.id ?? String(order.orderId);
    return [
      [
        id,
        {
          id,
          number: order.orderId,
          created,
          ready: time(order.readyAt),
          cancelled: time(order.cancelledAt),
          drinkCups: order.getDrinkCups().length,
          day: jstDate(created),
        },
      ],
    ];
  });
  return [...new Map(mapped).values()];
};

/**
 * 選択日（JST）の注文に、受付時点の stack を付ける。stack は時点に依らない（research.md R3）。
 * 戻り値は受付時刻の昇順。選択日より前の日の未完了の注文は otherDays に入れる（stack には数えない）。
 */
export const stackObservations = (
  orders: readonly StackOrder[],
  day: string,
): StackInput => {
  const sameDay = orders
    .filter((order) => order.day === day)
    .sort((a, b) => a.created - b.created);
  const observations = sameDay.map((order) => {
    let stack = 0;
    for (const other of sameDay) {
      if (other.created >= order.created) break;
      if (other.ready !== null && other.ready <= order.created) continue;
      if (other.cancelled !== null && other.cancelled <= order.created)
        continue;
      stack += other.drinkCups;
    }
    const { day: _, ...rest } = order;
    return {
      ...rest,
      stack,
      brokenTime: order.ready !== null && order.ready < order.created,
    };
  });
  const otherDays = orders.filter(
    (order) =>
      order.day < day && order.cancelled === null && order.ready === null,
  );
  return { observations, otherDays };
};

type Classification = "outside" | "cancelled" | "broken" | "fitted" | "pending";

/**
 * 時点 asOf での観測の状態。打刻は asOf より前のものだけが見えている（半開区間）。
 * 期間の開始前と、時点より後の受付は "outside"（当てはめにも件数にも入れない）。
 */
const classify = (
  observation: StackObservation,
  window: TimeWindow,
  asOf: number,
): Classification => {
  if (observation.created < window.start || observation.created >= asOf) {
    return "outside";
  }
  if (observation.cancelled !== null && observation.cancelled < asOf) {
    return "cancelled";
  }
  if (observation.brokenTime) return "broken";
  if (observation.ready !== null && observation.ready < asOf) return "fitted";
  return "pending";
};

const serviceMinutes = (observation: StackObservation) =>
  ((observation.ready as number) - observation.created) / 60_000;

/** 時点 asOf での当てはめの対象 */
const fittedObservations = (
  input: StackInput,
  window: TimeWindow,
  asOf: number,
) =>
  input.observations.filter(
    (observation) => classify(observation, window, asOf) === "fitted",
  );

const fitAt = (fitted: readonly StackObservation[]) =>
  fitStackModel(
    fitted.map((o) => ({ stack: o.stack, minutes: serviceMinutes(o) })),
  );

/**
 * 時点 asOf（= min(window.end, now)）でのページ全体の計算結果。
 * 当てはめの対象は window.start ≤ created < asOf、かつ取消されず、created ≤ ready < asOf の注文。
 */
export const stackModelView = (
  input: StackInput,
  window: TimeWindow,
  asOf: number,
): StackModelView => {
  const live = asOf < window.end;
  const counts: FitCounts = {
    fitted: 0,
    pending: 0,
    cancelled: 0,
    broken: 0,
    latestTimestamp: null,
  };
  for (const observation of input.observations) {
    const state = classify(observation, window, asOf);
    if (state === "outside") continue;
    counts[state]++;
    for (const t of [
      observation.created,
      observation.ready,
      observation.cancelled,
    ]) {
      if (t !== null && t < asOf) {
        counts.latestTimestamp = Math.max(counts.latestTimestamp ?? t, t);
      }
    }
  }
  const fitted = fittedObservations(input, window, asOf);
  const fit = fitAt(fitted);

  // 選択日に受け付け、時点で取消されておらず、提供可能になっていない注文（期間の開始前も含む）
  const waiting = input.observations.filter(
    (o) =>
      o.created < asOf &&
      (o.cancelled === null || o.cancelled >= asOf) &&
      (o.ready === null || o.ready >= asOf),
  );
  const stack = waiting.reduce((sum, o) => sum + o.drinkCups, 0);
  const oldest = waiting.reduce<number | null>(
    (min, o) => (min === null ? o.created : Math.min(min, o.created)),
    null,
  );
  const now: NowState = {
    asOf,
    live,
    stack,
    pendingOrders: waiting.length,
    oldestWaitMinutes: oldest === null ? null : (asOf - oldest) / 60_000,
    predictedFit: predictWithFit(fit, stack),
    predictedFixed: predictReadyMinutes(stack),
    extrapolated: fit.ok && stack > fit.stackMax,
    otherDayPending: input.otherDays.length,
  };

  const scatter = scatterOf(fitted, fit, stack);
  return {
    asOf,
    live,
    fit,
    fixed: STACK_MODEL,
    counts,
    now,
    ...scatter,
    accuracy: accuracyOf(fitted, fit),
    bins: binsOf(fitted, fit),
    warnings: stackWarnings(fit, stack, now.otherDayPending),
  };
};

const ascending = (values: number[]) => values.sort((a, b) => a - b);

/** 散布図の点・曲線・縦軸の上限（research.md R11） */
const scatterOf = (
  fitted: readonly StackObservation[],
  fit: StackFit,
  nowStack: number,
) => {
  const minutes = fitted.map(serviceMinutes);
  const upper = fit.ok
    ? fit.stackMax
    : fitted.reduce((max, o) => Math.max(max, o.stack), 0);
  const top = Math.max(upper, nowStack);
  const curve: CurvePoint[] = [];
  for (let i = 0; i * 0.5 <= top; i++) {
    const stack = i * 0.5;
    curve.push({
      stack,
      fit: predictWithFit(fit, stack),
      fixed: predictReadyMinutes(stack),
    });
  }
  const sorted = ascending([...minutes]);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const fence = q1 !== null && q3 !== null ? q3 + 3 * (q3 - q1) : 0;
  const curveMax = curve.reduce(
    (max, p) => Math.max(max, p.fixed, p.fit ?? 0),
    0,
  );
  const yMax = Math.ceil(Math.max(fence, curveMax) / 5) * 5;
  const points: ScatterPoint[] = fitted.map((o, i) => ({
    number: o.number,
    stack: o.stack,
    minutes: minutes[i],
    predictedFit: predictWithFit(fit, o.stack),
    predictedFixed: predictReadyMinutes(o.stack),
    clipped: minutes[i] > yMax,
  }));
  return {
    points,
    curve,
    yMax,
    clippedCount: points.filter((p) => p.clipped).length,
  };
};

const accuracyRow = (
  method: AccuracyRow["method"],
  actual: readonly number[],
  predicted: readonly number[] | null,
): AccuracyRow => {
  if (predicted === null || actual.length === 0) {
    return {
      method,
      n: actual.length,
      meanResidual: null,
      mae: null,
      medianAbsError: null,
    };
  }
  const residuals = actual.map((v, i) => v - predicted[i]);
  const absolute = ascending(residuals.map(Math.abs));
  const mean = (values: readonly number[]) =>
    values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    method,
    n: actual.length,
    meanResidual: mean(residuals),
    mae: mean(absolute),
    medianAbsError: quantile(absolute, 0.5),
  };
};

/** 精度の要約。"mean" の予測は実測の平均（標本内。R の baseline と同じ） */
const accuracyOf = (
  fitted: readonly StackObservation[],
  fit: StackFit,
): AccuracyRow[] => {
  const actual = fitted.map(serviceMinutes);
  const average = actual.reduce((sum, v) => sum + v, 0) / actual.length;
  return [
    accuracyRow(
      "fit",
      actual,
      fit.ok ? fitted.map((o) => predictWithFit(fit, o.stack) as number) : null,
    ),
    accuracyRow(
      "fixed",
      actual,
      fitted.map((o) => predictReadyMinutes(o.stack)),
    ),
    accuracyRow(
      "mean",
      actual,
      actual.map(() => average),
    ),
  ];
};

/** stack の区間表。幅 2 杯で区切る（R の stack_bins() と同じ） */
const binsOf = (
  fitted: readonly StackObservation[],
  fit: StackFit,
): StackBin[] => {
  const groups = new Map<number, number[]>();
  for (const o of fitted) {
    const lo = Math.floor(o.stack / 2) * 2;
    groups.set(lo, [...(groups.get(lo) ?? []), serviceMinutes(o)]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([lo, minutes]) => {
      const sorted = ascending(minutes);
      return {
        lo,
        hi: lo + 1,
        n: sorted.length,
        p10: quantile(sorted, 0.1),
        median: quantile(sorted, 0.5),
        p90: quantile(sorted, 0.9),
        predictedFit: predictWithFit(fit, lo + 0.5),
        predictedFixed: predictReadyMinutes(lo + 0.5),
      };
    });
};

/** 警告の判定（research.md R12）。当てはめが不能なら、前日以前の未完了だけを返す */
export const stackWarnings = (
  fit: StackFit,
  nowStack: number,
  otherDayPending: number,
): StackWarning[] => {
  const warnings: StackWarning[] = [];
  if (fit.ok) {
    if (fit.a1 < fit.stackMin || fit.a1 > fit.stackMax) {
      warnings.push({
        kind: "a1-out-of-range",
        a1: fit.a1,
        stackMin: fit.stackMin,
        stackMax: fit.stackMax,
      });
    }
    if (fit.b <= 0) warnings.push({ kind: "non-positive-slope", b: fit.b });
    if (nowStack > fit.stackMax) {
      warnings.push({
        kind: "extrapolation",
        stack: nowStack,
        stackMax: fit.stackMax,
      });
    }
  }
  if (otherDayPending > 0) {
    warnings.push({ kind: "other-day-pending", count: otherDayPending });
  }
  return warnings;
};

/** 当てはめ結果を推移の点に写す。不能なら係数を null にする（0 や直前の値で埋めない） */
export const trendPointFromFit = (
  fit: StackFit,
  asOf: number,
  partial: boolean,
): TrendPoint =>
  fit.ok
    ? {
        asOf,
        partial,
        nObs: fit.nObs,
        a1: fit.a1,
        c1: fit.c1,
        b: fit.b,
        reason: null,
      }
    : {
        asOf,
        partial,
        nObs: fit.nObs,
        a1: null,
        c1: null,
        b: null,
        reason: fit.reason,
      };

/**
 * 集計間隔ごとの区切りの終わり（と途中の最後の点）での当てはめ。
 * completedUntil より前の点は、入力が同じなら同じ結果になる（UI はこれを useMemo のキーにする）。
 */
export const stackModelTrend = (
  input: StackInput,
  window: TimeWindow,
  asOf: number,
  intervalMinutes: BucketMinutes,
): TrendPoint[] => {
  const step = intervalMinutes * 60_000;
  const times: { at: number; partial: boolean }[] = [];
  for (let at = window.start + step; at <= asOf; at += step) {
    times.push({ at, partial: false });
  }
  const lastEnd = times.at(-1)?.at ?? window.start;
  if (asOf > lastEnd) times.push({ at: asOf, partial: true });
  return times.map(({ at, partial }) =>
    trendPointFromFit(
      fitAt(fittedObservations(input, window, at)),
      at,
      partial,
    ),
  );
};
