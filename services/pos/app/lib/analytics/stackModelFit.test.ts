import { describe, expect, test } from "vitest";
import {
  STACK_FIT_STARTS,
  type StackFit,
  fitFromStart,
  fitStackModel,
  predictWithFit,
  stackModelMinutes,
} from "./stackModelFit";

// 乱数を使わないばらつき（−0.5〜+0.5 分）。残差がちょうど 0 だと nls と同じく収束と判定できない。
const noise = (i: number) => (((i * 37) % 11) - 5) * 0.1;

/** 真の係数から合成データを作る。stack = 0..maxStack を各 3 回 */
const synthetic = (a1: number, b1: number, c1: number, maxStack: number) => {
  const b = b1 + c1 / 6;
  const points: { stack: number; minutes: number }[] = [];
  for (let stack = 0; stack <= maxStack; stack++) {
    for (let k = 0; k < 3; k++) {
      points.push({
        stack,
        minutes: stackModelMinutes(stack, a1, b, c1) + noise(points.length),
      });
    }
  }
  return points;
};

describe("[unit] stackModelMinutes", () => {
  test("stack ≤ a1 なら c1", () => {
    expect(stackModelMinutes(3, 5, 0.5, 6)).toBe(6);
  });
  test("折れ点ちょうどは c1", () => {
    expect(stackModelMinutes(5, 5, 0.5, 6)).toBe(6);
  });
  test("折れ点より右は b × (stack − a1) + c1", () => {
    expect(stackModelMinutes(9, 5, 0.5, 6)).toBe(8);
  });
  test("b ≤ 0 なら max で c1", () => {
    expect(stackModelMinutes(9, 5, -0.1, 6)).toBe(6);
  });
});

describe("[unit] predictWithFit", () => {
  const ok: StackFit = {
    ok: true,
    a1: 5,
    b1: -0.5,
    c1: 6,
    nStaff: 6,
    b: 0.5,
    nObs: 30,
    iterations: 4,
    start: { a1: 5, b1: 0.1, c1: 2 },
    stackMin: 0,
    stackMax: 20,
  };
  test("当てはめ不能なら null", () => {
    expect(
      predictWithFit(
        { ok: false, reason: "insufficient", nObs: 3, needed: 20 },
        10,
      ),
    ).toBeNull();
    expect(
      predictWithFit({ ok: false, reason: "no-convergence", nObs: 30 }, 10),
    ).toBeNull();
  });
  test("当てはめ済みなら stackModelMinutes と同じ値", () => {
    for (const stack of [0, 5, 9, 25]) {
      expect(predictWithFit(ok, stack)).toBe(
        stackModelMinutes(stack, 5, 0.5, 6),
      );
    }
  });
});

describe("[unit] fitStackModel: 既知の係数を復元する", () => {
  // 真の係数: a1 = 6、b1 = −0.5、c1 = 6（b = 0.5）
  const points = synthetic(6, -0.5, 6, 20);

  test("係数・件数・範囲・反復の回数", () => {
    expect(points).toHaveLength(63);
    const fit = fitStackModel(points);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.nStaff).toBe(6);
    expect(fit.nObs).toBe(63);
    expect(fit.stackMin).toBe(0);
    expect(fit.stackMax).toBe(20);
    expect(Math.abs(fit.a1 - 6)).toBeLessThan(0.3);
    expect(Math.abs(fit.c1 - 6)).toBeLessThan(0.3);
    expect(Math.abs(fit.b - 0.5)).toBeLessThan(0.05);
    expect(fit.b).toBeCloseTo(fit.b1 + fit.c1 / 6, 12);
    for (const value of [fit.a1, fit.b1, fit.c1, fit.b]) {
      expect(Number.isFinite(value)).toBe(true);
    }
    expect(fit.iterations).toBeGreaterThanOrEqual(1);
    expect(fit.iterations).toBeLessThanOrEqual(50);
    expect(STACK_FIT_STARTS).toContainEqual(fit.start);
  });

  test("同じ入力には同じ結果を返す", () => {
    expect(fitStackModel(points)).toEqual(fitStackModel(points));
  });
});

describe("[unit] fitStackModel: 当てはめ不能", () => {
  const points = synthetic(6, -0.5, 6, 20);

  test("19 点は件数不足", () => {
    expect(fitStackModel(points.slice(0, 19))).toEqual({
      ok: false,
      reason: "insufficient",
      nObs: 19,
      needed: 20,
    });
  });

  test("0 点は件数不足", () => {
    expect(fitStackModel([])).toEqual({
      ok: false,
      reason: "insufficient",
      nObs: 0,
      needed: 20,
    });
  });

  test("全点が折れ点の左なら収束しない", () => {
    // stack 0〜3 だけ。どの初期値（a1 = 5・10・15）でも勾配が特異になる。
    const left = Array.from({ length: 24 }, (_, i) => ({
      stack: i % 4,
      minutes: 6 + noise(i),
    }));
    const fit = fitStackModel(left);
    expect(fit.ok).toBe(false);
    if (fit.ok) return;
    expect(fit.reason).toBe("no-convergence");
    expect(fit.nObs).toBe(24);
    expect("a1" in fit).toBe(false);
    expect("b" in fit).toBe(false);
  });
});

describe("[unit] fitStackModel: 初期値を順に試す", () => {
  // 真の折れ点が整数の stack にちょうど重なると、最適点が微分できない点に来て
  // nls と同じ手順では収束しない（a1 = 14 で確かめた）。そのため 14.5 にずらす。
  const datasets = {
    "a1 = 6": synthetic(6, -0.5, 6, 20),
    "a1 = 14.5": synthetic(14.5, -0.3, 5, 25),
    // 傾きがほぼ 0 で、1 つ目・2 つ目の初期値では収束しない
    ほぼ平坦: synthetic(2.5, -0.3, 2, 20),
  };

  test.each(Object.entries(datasets))(
    "%s: 最初に収束した初期値を使う",
    (_, points) => {
      const expected = STACK_FIT_STARTS.find(
        (start) => fitFromStart(points, start).ok,
      );
      expect(expected).toBeDefined();
      const fit = fitStackModel(points);
      expect(fit.ok).toBe(true);
      if (!fit.ok || !expected) return;
      expect(fit.start).toEqual(expected);
      const reference = fitFromStart(points, expected);
      if (!reference.ok) throw new Error("基準の初期値で収束していない");
      expect(fit.a1).toBe(reference.a1);
      expect(fit.b1).toBe(reference.b1);
      expect(fit.c1).toBe(reference.c1);
    },
  );

  test("1 つ目の初期値で収束しなければ、次の初期値を試す", () => {
    const points = datasets.ほぼ平坦;
    expect(fitFromStart(points, STACK_FIT_STARTS[0]).ok).toBe(false);
    const fit = fitStackModel(points);
    expect(fit.ok).toBe(true);
    if (!fit.ok) return;
    expect(fit.start).not.toEqual(STACK_FIT_STARTS[0]);
  });
});
