/**
 * 負の二項分布（NB2）。平均 mu・分散 mu + alpha·mu²。杯数（0, 1, 2, …）の分布に使う。
 * sohosai-analysis の scoring.py（scipy）と同じ定義：alpha が poissonAlpha より小さければポアソン、mu = 0 は 0 杯の 1 点。
 * 確率は対数で漸化式を進めてから戻す（大きい mu でも 0 にならないように）。
 */

/** 上側の確率がこれより小さくなったら打ち切る */
const TAIL = 1e-13;
/** 打ち切りの上限（杯）。mu の何倍・何杯先まで見るか */
const MAX_SPAN = 50_000;

export interface CupDistribution {
  readonly mu: number;
  readonly alpha: number;
  /** P(R ≤ s)。s < 0 は 0 */
  cdf(s: number): number;
  /** P(R > s)。s 杯の在庫が切れる確率 */
  exceedance(s: number): number;
  /** P(R ≤ s) ≥ q となる最小の s */
  quantile(q: number): number;
}

export function nb2(
  mu: number,
  alpha: number,
  poissonAlpha = 1e-8,
): CupDistribution {
  if (!Number.isFinite(mu) || mu < 0 || !Number.isFinite(alpha) || alpha < 0)
    throw new Error(`NB2 の母数が不正です（mu=${mu}, alpha=${alpha}）`);
  const cumulative: number[] = [];
  if (mu === 0) {
    cumulative.push(1);
  } else {
    const poisson = alpha < poissonAlpha;
    const n = poisson ? 0 : 1 / alpha;
    // log p(0) と、k → k + 1 の比
    let logP = poisson ? -mu : n * Math.log(n / (n + mu));
    const logRatio = poisson ? Math.log(mu) : Math.log(mu / (n + mu));
    let total = 0;
    for (let k = 0; k < MAX_SPAN; k++) {
      total += Math.exp(logP);
      cumulative.push(Math.min(total, 1));
      if (k > mu && 1 - total < TAIL) break;
      logP += logRatio + Math.log((poisson ? 1 : k + n) / (k + 1));
    }
  }
  const last = cumulative.length - 1;
  const cdf = (s: number) => {
    if (s < 0) return 0;
    const k = Math.floor(s);
    return k >= last ? cumulative[last] : cumulative[k];
  };
  return {
    mu,
    alpha,
    cdf,
    exceedance: (s) => Math.max(0, 1 - cdf(s)),
    quantile: (q) => {
      // scipy と同じく、浮動小数の誤差で q をわずかに下回る点を落とさないよう小さな幅を許す
      const target = q - 1e-12;
      const k = cumulative.findIndex((v) => v >= target);
      return k === -1 ? last : k;
    },
  };
}
