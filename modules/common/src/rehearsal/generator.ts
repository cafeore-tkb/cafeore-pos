// 注文列の生成器。sohosai-analysis の ordergen.py（T-60・T-61）を TypeScript に移したもの。
//
// * 到着：いまいるビンのレートが属する層の「実際の間隔」から引いて足していく
// * 中身：過去の注文の組を、出た回数に比例して 1 件ずつ引く。時刻とは独立
//
// 乱数は numpy と違うので、Python 版と同じ seed でも同じ列にはならない。
// 分布として同じものを引いている。
//
// **作るのは「過去の体制でさばけた注文の流れ」の再現で、需要の予測ではない。**
// 連続する注文どうしの相関（同じ集団が続けて頼むなど）も再現しない。

import type { Basket, GeneratorParams } from "./params";
import { stratumOf } from "./params";

/** 0 以上 1 未満の一様乱数を返す関数 */
export type Rng = () => number;

/** seed を固定できる小さな乱数（mulberry32） */
export const mulberry32 = (seed: number): Rng => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const pick = <T>(rng: Rng, values: readonly T[]): T =>
  values[Math.floor(rng() * values.length)];

/** 生成される間隔の下限（秒）。観測された最短の間隔 */
export const minGapSec = (params: GeneratorParams) =>
  Math.min(...params.gapsByStratum.map((gaps) => Math.min(...gaps)));

/**
 * 混雑の段（注文の頻度 × level）→ 間隔に掛ける倍率。
 * 下限で止まるので、× 1.6 で注文がちょうど 1.6 倍になるとは限らない。
 */
export const scaleOfLevel = (level: number) => {
  if (!(level > 0)) {
    throw new Error(`混雑の段は正の数にしてください: ${level}`);
  }
  return 1 / level;
};

/** ずっと同じレートのプロファイル。混む時間帯だけを練習するときに使う */
export const flatProfile = (
  rate: number,
  durationMin: number,
  binMinutes: number,
) =>
  new Array<number>(Math.max(1, Math.ceil(durationMin / binMinutes))).fill(
    rate,
  );

export type OffsetOptions = {
  /** ビンごとのレート（件/分） */
  profile: readonly number[];
  /** 生成する長さ（分） */
  durationMin: number;
  /** 間隔に掛ける倍率。1 未満で混む（`scaleOfLevel()`） */
  scale?: number;
  /** 間隔の下限（秒）。省略すると観測の最短 */
  floorSec?: number;
};

/**
 * 受付の時刻（開始からの秒）を昇順で返す。1 件目は 0 秒。
 *
 * 間隔を詰めても下限は縮めない — 「客は増えるがレジは今のまま」という仮定（T-61）。
 */
export const sampleOffsets = (
  params: GeneratorParams,
  rng: Rng,
  { profile, durationMin, scale = 1, floorSec }: OffsetOptions,
): number[] => {
  if (profile.length === 0) {
    throw new Error("プロファイルが空です");
  }
  if (!(scale > 0)) {
    throw new Error(`倍率は正の数にしてください: ${scale}`);
  }
  const widthSec = params.binMinutes * 60;
  const totalSec = durationMin * 60;
  const floor = floorSec ?? minGapSec(params);

  const offsets = [0];
  let t = 0;
  for (;;) {
    const index = Math.min(Math.floor(t / widthSec), profile.length - 1);
    const gaps = params.gapsByStratum[stratumOf(profile[index], params.edges)];
    t += Math.max(scale * pick(rng, gaps), floor);
    if (t > totalSec) return offsets;
    offsets.push(t);
  }
};

/** 注文の組を `n` 件、出た回数に比例して引く */
export const sampleBaskets = (
  params: GeneratorParams,
  rng: Rng,
  n: number,
): Basket[] => {
  const cumulative: number[] = [];
  let total = 0;
  for (const basket of params.baskets) {
    total += basket.weight;
    cumulative.push(total);
  }
  return Array.from({ length: n }, () => {
    const r = rng() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] > r) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    return params.baskets[lo];
  });
};

export type GeneratedOrder = {
  /** 開始からの秒 */
  offsetSec: number;
  /** 役割ごとの杯数（物販は入らない） */
  roles: Record<string, number>;
  drinkCups: number;
  goods: number;
};

/** 注文列を作る。同じ params・seed・オプションなら同じ列になる */
export const generateOrders = (
  params: GeneratorParams,
  options: OffsetOptions & { seed: number },
): GeneratedOrder[] => {
  const rng = mulberry32(options.seed);
  // Python 版と同じく、時刻を先に全部引いてから中身を引く
  const offsets = sampleOffsets(params, rng, options);
  const baskets = sampleBaskets(params, rng, offsets.length);
  return offsets.map((offsetSec, i) => ({
    offsetSec,
    roles: baskets[i].roles,
    drinkCups: Object.values(baskets[i].roles).reduce((sum, n) => sum + n, 0),
    goods: baskets[i].goods,
  }));
};
