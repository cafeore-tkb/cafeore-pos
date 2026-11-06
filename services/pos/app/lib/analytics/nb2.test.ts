import { describe, expect, test } from "vitest";
import checks from "./data/stockout-checks-2026.json";
import { nb2 } from "./nb2";

describe("unit stockout NB2", () => {
  test("分布関数と分位点が sohosai-analysis（scipy）の正解と一致する", () => {
    for (const c of checks.nb) {
      const d = nb2(c.mu, c.alpha);
      c.s.forEach((s, i) => expect(d.cdf(s)).toBeCloseTo(c.cdf[i], 10));
      for (const [q, v] of Object.entries(c.quantiles))
        expect(d.quantile(Number(q))).toBe(v);
    }
  });
  test("超過確率は s について単調に減り、mu = 0 は 0 杯の 1 点", () => {
    const d = nb2(21, 0.06);
    let prev = 1;
    for (let s = 0; s < 80; s++) {
      expect(d.exceedance(s)).toBeLessThanOrEqual(prev + 1e-15);
      prev = d.exceedance(s);
    }
    expect(d.exceedance(-1)).toBe(1);
    const closed = nb2(0, 0.3);
    expect(closed.exceedance(0)).toBe(0);
    expect(closed.quantile(0.95)).toBe(0);
  });
  test("大きな平均でも確率が 0 に潰れない", () => {
    const d = nb2(900, 0.05);
    expect(d.cdf(900)).toBeGreaterThan(0.4);
    expect(d.cdf(900)).toBeLessThan(0.6);
  });
  test("不正な母数は止める", () => {
    expect(() => nb2(-1, 0.1)).toThrow();
    expect(() => nb2(1, Number.NaN)).toThrow();
  });
});
