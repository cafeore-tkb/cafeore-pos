// 過去の注文から、注文列の生成器（./generator.ts）が引くパラメータを作る。
//
// sohosai-analysis の生成器（2025/nisui/cafeore_analysis/python/src/cafeore/ordergen.py）と
// 同じ決め方をなぞる。決め方の理由は向こうの docs/python-track.md §12〜13 にある。
//
// * 到着：日ごとに、その日の初回注文を起点とする 10 分ビンに載せ、ビンのレート（件/分）の
//   四分位で注文を 4 層に分ける。層ごとに「直前の注文からの間隔」を集める
// * 中身：注文 1 件を役割カテゴリの組にして、同じ組をまとめて回数を数える
//
// **観測されているのは需要ではなく、その日の体制でさばけた注文**（スループット）。

import { GOODS_ROLE, roleOf } from "./roles";

/** 過去の注文 JSON（`{ orders: [...] }`）の 1 件。使う項目だけ */
export type RawOrder = {
  orderId: number;
  createdAt: string;
  readyAt?: string | null;
  items: { id: string }[];
};

/** 注文の組。`weight` は過去にその組が出た回数 */
export type Basket = {
  /** 役割ごとの杯数（物販は入らない） */
  roles: Record<string, number>;
  /** 物販の個数 */
  goods: number;
  weight: number;
};

/** 1 日ぶんのビンのレート。生成器にそのまま渡せる */
export type DayProfile = {
  /** 開催日（日本時間） */
  date: string;
  /** その日の初回注文の時刻（日本時間、HH:mm:ss） */
  openAt: string;
  /** 初回注文から最後の注文までの長さ（分） */
  durationMin: number;
  /** ビンごとのレート（件/分） */
  binRates: number[];
};

export type GeneratorParams = {
  version: 1;
  /** 対象にした開催日と注文の件数 */
  source: { dates: string[]; orders: number };
  binMinutes: number;
  /** 層の境界（件/分）。昇順で 3 つ */
  edges: number[];
  /** 層ごとの注文間隔（秒）。0 が最も暇な層 */
  gapsByStratum: number[][];
  baskets: Basket[];
  days: DayProfile[];
};

/** ビンの幅（分）。sohosai-analysis の T-56a の決定 */
export const BIN_MINUTES = 10;
/** 層の数（ビンのレートの四分位） */
export const RATE_STRATA = 4;
/** これを超える間隔は営業の中断とみなして捨てる（R/metrics.R の add_duration） */
export const GAP_THRESHOLD_SEC = 5000;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const jstDate = (ms: number) =>
  new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10);
const jstClock = (ms: number) =>
  new Date(ms + JST_OFFSET_MS).toISOString().slice(11, 19);

/** pandas の `Series.quantile()`（既定の線形補間）と同じ値を返す */
export const quantile = (sorted: number[], q: number): number => {
  if (sorted.length === 0) {
    throw new Error("空の列の分位点は取れません");
  }
  const h = (sorted.length - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
};

/** `np.digitize(rate, edges)` と同じ。境界ちょうどは上の層に入る */
export const stratumOf = (rate: number, edges: readonly number[]): number =>
  edges.filter((edge) => rate >= edge).length;

type Tagged = {
  ms: number;
  gapSec: number | null;
  rate: number;
  order: RawOrder;
};

/** 1 日ぶんの注文（受付順）にビンのレートと直前からの間隔を付ける */
export const tagDay = (day: RawOrder[], binMs: number) => {
  const times = day.map((order) => Date.parse(order.createdAt));
  const origin = times[0];
  const last = times[times.length - 1];
  const nBins = Math.max(1, Math.ceil((last - origin) / binMs));
  const index = times.map((t) =>
    Math.min(Math.floor((t - origin) / binMs), nBins - 1),
  );

  const counts = new Array<number>(nBins).fill(0);
  for (const i of index) counts[i] += 1;

  // 最後のビンは「最後の注文まで」しか営業していないので、そのぶんだけ露出が短い
  const lastStart = origin + (nBins - 1) * binMs;
  const rates = counts.map((count, i) => {
    const exposureMs =
      i < nBins - 1 ? binMs : Math.max(last, lastStart) - lastStart;
    if (exposureMs === 0) {
      throw new Error(`${jstDate(origin)} の最後のビンの長さが 0 です`);
    }
    return count / (exposureMs / 60_000);
  });

  const tagged: Tagged[] = day.map((order, i) => {
    // 日の最初の注文と、営業の中断をまたぐ間隔は使わない
    const gap = i === 0 ? null : (times[i] - times[i - 1]) / 1000;
    return {
      ms: times[i],
      gapSec: gap !== null && gap <= GAP_THRESHOLD_SEC ? gap : null,
      rate: rates[index[i]],
      order,
    };
  });

  const profile: DayProfile = {
    date: jstDate(origin),
    openAt: jstClock(origin),
    durationMin: (last - origin) / 60_000,
    binRates: rates,
  };
  return { tagged, profile };
};

const basketOf = (order: RawOrder) => {
  const roles: Record<string, number> = {};
  let goods = 0;
  for (const item of order.items) {
    const role = roleOf(item.id);
    if (role === GOODS_ROLE) {
      goods += 1;
    } else {
      roles[role] = (roles[role] ?? 0) + 1;
    }
  }
  return { roles, goods };
};

/** 役割を辞書順に並べた組のキー。同じ組をまとめるのに使う */
export const basketKey = (roles: Record<string, number>, goods: number) =>
  JSON.stringify([
    Object.keys(roles)
      .sort()
      .map((role) => [role, roles[role]]),
    goods,
  ]);

/**
 * 過去の注文からパラメータを作る。
 *
 * @param orders 過去の注文。複数年を混ぜてよい
 * @param dates 対象にする開催日（日本時間）。祭の日だけを渡す — 練習やリハーサルは本番の代表性が無い
 */
export const fitParams = (
  orders: RawOrder[],
  dates: string[],
): GeneratorParams => {
  const binMs = BIN_MINUTES * 60_000;
  const wanted = new Set(dates);

  // 壊れたレコード（readyAt が無い・受付より前）を落とす（R の clean_orders の drop_broken）
  const kept = orders.filter((order) => {
    if (!wanted.has(jstDate(Date.parse(order.createdAt)))) return false;
    if (!order.readyAt) return false;
    return Date.parse(order.readyAt) >= Date.parse(order.createdAt);
  });

  const byDay = new Map<string, RawOrder[]>();
  for (const order of kept) {
    const date = jstDate(Date.parse(order.createdAt));
    const day = byDay.get(date);
    if (day) {
      day.push(order);
    } else {
      byDay.set(date, [order]);
    }
  }
  const missing = dates.filter((date) => !byDay.has(date));
  if (missing.length > 0) {
    throw new Error(`注文が 1 件も無い開催日があります: ${missing.join(", ")}`);
  }

  const days = [...byDay.keys()].sort().map((date) => {
    const day = [...(byDay.get(date) ?? [])].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
    return tagDay(day, binMs);
  });
  const tagged = days.flatMap((day) => day.tagged);

  const sortedRates = tagged.map((t) => t.rate).sort((a, b) => a - b);
  const edges = Array.from({ length: RATE_STRATA - 1 }, (_, i) =>
    quantile(sortedRates, (i + 1) / RATE_STRATA),
  );

  const gapsByStratum = Array.from(
    { length: RATE_STRATA },
    () => [] as number[],
  );
  for (const t of tagged) {
    if (t.gapSec !== null)
      gapsByStratum[stratumOf(t.rate, edges)].push(t.gapSec);
  }

  // 中身は全日をまとめて数える（§12-1）。品目の無い注文は組にならない
  const baskets = new Map<string, Basket>();
  for (const t of tagged) {
    if (t.order.items.length === 0) continue;
    const { roles, goods } = basketOf(t.order);
    const key = basketKey(roles, goods);
    const found = baskets.get(key);
    if (found) {
      found.weight += 1;
    } else {
      baskets.set(key, { roles, goods, weight: 1 });
    }
  }

  const empty = gapsByStratum.findIndex((gaps) => gaps.length === 0);
  if (empty >= 0) {
    throw new Error(
      `層 ${empty} に間隔が 1 つもありません。開催日を増やしてください`,
    );
  }

  return {
    version: 1,
    source: { dates: [...dates].sort(), orders: tagged.length },
    binMinutes: BIN_MINUTES,
    edges,
    gapsByStratum,
    baskets: [...baskets.values()].sort((a, b) => b.weight - a.weight),
    days: days.map((day) => day.profile),
  };
};
