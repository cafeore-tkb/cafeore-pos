/** 当てはめの初期値の候補。解析リポジトリの QUICKVIEW_STARTS と同じ順序で、最初に収束したものを使う */
export const STACK_FIT_STARTS: readonly StackFitStart[] = [
  { a1: 5, b1: 0.1, c1: 2 },
  { a1: 10, b1: 0.1, c1: 2 },
  { a1: 15, b1: 0.1, c1: 2 },
];
/** これより当てはめに使える観測が少なければ当てはめない（QUICKVIEW_MIN_OBS） */
export const STACK_FIT_MIN_OBS = 20;
/** 抽出担当の人数。2026 年は 6 人で固定（FR-007） */
export const STACK_FIT_N_STAFF = 6;

export interface StackFitStart {
  a1: number;
  b1: number;
  c1: number;
}
export interface StackFitPoint {
  stack: number;
  minutes: number;
}

/** 当てはめ結果。不能のときは係数を持たない（SC-006） */
export type StackFit =
  | {
      ok: true;
      a1: number;
      b1: number;
      c1: number;
      nStaff: number;
      /** 実効傾き b1 + c1 / nStaff */
      b: number;
      nObs: number;
      iterations: number;
      start: StackFitStart;
      stackMin: number;
      stackMax: number;
    }
  | {
      ok: false;
      reason: "insufficient";
      nObs: number;
      needed: typeof STACK_FIT_MIN_OBS;
    }
  | { ok: false; reason: "no-convergence"; nObs: number };

/** max(b × (stack − a1) + c1, c1)。b は実効傾き */
export const stackModelMinutes = (
  stack: number,
  a1: number,
  b: number,
  c1: number,
): number => Math.max(b * (stack - a1) + c1, c1);

// R の nls.control() の既定と同じ
const MAX_ITER = 50;
const TOLERANCE = 1e-5;
const MIN_FACTOR = 1 / 1024;
// R の qr()（LINPACK dqrdc2）の既定の許容誤差
const QR_TOLERANCE = 1e-7;

interface Evaluation {
  ssr: number;
  /** Qᵀr の先頭 3 つ（増分と収束の判定に使う） */
  head: [number, number, number];
  /** Qᵀr の 4 つ目以降の二乗和 */
  tailSsr: number;
  /** QR の R（上三角、行優先） */
  r: number[][];
}

/**
 * θ = (a1, b1, c1) での残差とヤコビアンを作り、Householder の QR 分解にかける。
 * 階数が 3 未満（勾配が特異）なら null。
 */
const evaluate = (
  points: readonly StackFitPoint[],
  [a1, b1, c1]: readonly number[],
  nStaff: number,
): Evaluation | null => {
  const n = points.length;
  const b = b1 + c1 / nStaff;
  const columns = [
    new Float64Array(n),
    new Float64Array(n),
    new Float64Array(n),
  ];
  const residual = new Float64Array(n);
  let ssr = 0;
  for (let i = 0; i < n; i++) {
    const x = points[i].stack;
    const right = b * (x - a1) > 0;
    const fitted = right ? b * (x - a1) + c1 : c1;
    residual[i] = points[i].minutes - fitted;
    ssr += residual[i] ** 2;
    columns[0][i] = right ? -b : 0;
    columns[1][i] = right ? x - a1 : 0;
    columns[2][i] = right ? (x - a1) / nStaff + 1 : 1;
  }
  const r = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let k = 0; k < 3; k++) {
    const column = columns[k];
    let original = 0;
    let norm = 0;
    for (let i = 0; i < n; i++) {
      original += column[i] ** 2;
      if (i >= k) norm += column[i] ** 2;
    }
    original = Math.sqrt(original);
    norm = Math.sqrt(norm);
    if (!(norm > QR_TOLERANCE * original) || !Number.isFinite(norm)) {
      return null;
    }
    const alpha = column[k] > 0 ? -norm : norm;
    const v = column.slice(k);
    v[0] -= alpha;
    let vv = 0;
    for (let i = 0; i < v.length; i++) vv += v[i] ** 2;
    const reflect = (target: Float64Array) => {
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i] * target[k + i];
      const scale = (2 * dot) / vv;
      for (let i = 0; i < v.length; i++) target[k + i] -= scale * v[i];
    };
    for (let j = k + 1; j < 3; j++) reflect(columns[j]);
    reflect(residual);
    r[k][k] = alpha;
    for (let j = k + 1; j < 3; j++) r[k][j] = columns[j][k];
  }
  let tailSsr = 0;
  for (let i = 3; i < n; i++) tailSsr += residual[i] ** 2;
  return {
    ssr,
    head: [residual[0], residual[1], residual[2]],
    tailSsr,
    r,
  };
};

/** R δ = (Qᵀr)[1:3] の後退代入（R の qr.coef） */
const increment = ({ r, head }: Evaluation) => {
  const delta = [0, 0, 0];
  for (let k = 2; k >= 0; k--) {
    let sum = head[k];
    for (let j = k + 1; j < 3; j++) sum -= r[k][j] * delta[j];
    delta[k] = sum / r[k][k];
  }
  return delta;
};

/** 1 つの初期値だけで当てはめる。fitStackModel はこれを STACK_FIT_STARTS の順に呼ぶ */
export const fitFromStart = (
  points: readonly StackFitPoint[],
  start: StackFitStart,
  nStaff: number = STACK_FIT_N_STAFF,
): StackFit => {
  const failure: StackFit = {
    ok: false,
    reason: "no-convergence",
    nObs: points.length,
  };
  let theta = [start.a1, start.b1, start.c1];
  let current = evaluate(points, theta, nStaff);
  if (!current) return failure;
  let factor = 1;
  for (let iteration = 0; iteration < MAX_ITER; iteration++) {
    // R の nlsModel の convCrit（相対オフセット）
    const offset = Math.sqrt(
      current.head.reduce((sum, v) => sum + v ** 2, 0) / current.tailSsr,
    );
    if (offset <= TOLERANCE) {
      const [a1, b1, c1] = theta;
      const b = b1 + c1 / nStaff;
      if (![a1, b1, c1, b].every(Number.isFinite)) return failure;
      const stacks = points.map((p) => p.stack);
      return {
        ok: true,
        a1,
        b1,
        c1,
        nStaff,
        b,
        nObs: points.length,
        iterations: iteration,
        start: { ...start },
        stackMin: Math.min(...stacks),
        stackMax: Math.max(...stacks),
      };
    }
    const delta = increment(current);
    let accepted = false;
    while (factor >= MIN_FACTOR) {
      const next = theta.map((v, i) => v + factor * delta[i]);
      const trial = evaluate(points, next, nStaff);
      if (!trial) return failure;
      if (trial.ssr <= current.ssr) {
        theta = next;
        current = trial;
        factor = Math.min(2 * factor, 1);
        accepted = true;
        break;
      }
      factor /= 2;
    }
    if (!accepted) return failure;
  }
  return failure;
};

/**
 * nls（Gauss-Newton、step halving、相対オフセット 1e-5、最大 50 反復、minFactor 1/1024）互換の当てはめ。
 * points は当てはめ対象だけを渡す（未完了・取消・壊れた記録は呼び出し側で除く）。
 * 等重み・外れ値を除外しない。前回の結果は使わない。
 */
export const fitStackModel = (
  points: readonly StackFitPoint[],
  nStaff: number = STACK_FIT_N_STAFF,
): StackFit => {
  if (points.length < STACK_FIT_MIN_OBS) {
    return {
      ok: false,
      reason: "insufficient",
      nObs: points.length,
      needed: STACK_FIT_MIN_OBS,
    };
  }
  for (const start of STACK_FIT_STARTS) {
    const fit = fitFromStart(points, start, nStaff);
    if (fit.ok) return fit;
  }
  return { ok: false, reason: "no-convergence", nObs: points.length };
};

/** 当てはめ結果での予測（分）。不能なら null */
export const predictWithFit = (fit: StackFit, stack: number): number | null =>
  fit.ok ? stackModelMinutes(stack, fit.a1, fit.b, fit.c1) : null;
