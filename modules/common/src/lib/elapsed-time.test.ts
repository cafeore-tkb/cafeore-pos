import { describe, expect, test } from "vitest";
import { orderElapsedTime } from "./elapsed-time";

const at = (iso: string) => new Date(iso);
const START = at("2026-11-07T10:00:00+09:00");
// from に受け付けて to に提供した注文の経過時間
const between = (from: Date, to: Date) =>
  orderElapsedTime({ createdAt: from, servedAt: to });

describe("[unit] orderElapsedTime の分・秒・遅れ", () => {
  test("splits into minutes and 2-digit seconds, truncating milliseconds", () => {
    expect(between(START, at("2026-11-07T10:03:05+09:00"))).toEqual({
      m: 3,
      ss: "05",
      overdue: false,
    });
    expect(between(START, at("2026-11-07T10:00:59.999+09:00")).ss).toBe("59");
  });

  test("becomes overdue at exactly 15 minutes", () => {
    expect(between(START, at("2026-11-07T10:14:59.999+09:00")).overdue).toBe(
      false,
    );
    expect(between(START, at("2026-11-07T10:15:00+09:00")).overdue).toBe(true);
  });

  test("does not wrap at 60 minutes and works across midnight and days", () => {
    expect(between(START, at("2026-11-07T11:32:07+09:00"))).toMatchObject({
      m: 92,
      ss: "07",
    });
    expect(
      between(at("2026-11-07T23:50:00+09:00"), at("2026-11-08T00:10:15+09:00")),
    ).toMatchObject({ m: 20, ss: "15" });
    expect(between(START, at("2026-11-08T11:00:00+09:00")).m).toBe(25 * 60);
  });

  test("clamps negative durations to zero", () => {
    expect(between(START, at("2026-11-07T09:59:00+09:00"))).toEqual({
      m: 0,
      ss: "00",
      overdue: false,
    });
  });
});

describe("[unit] orderElapsedTime", () => {
  test("uses servedAt when served, now when not", () => {
    const now = at("2026-11-07T11:20:00+09:00");
    expect(
      orderElapsedTime(
        { createdAt: START, servedAt: at("2026-11-07T10:05:00+09:00") },
        now,
      ),
    ).toEqual({ m: 5, ss: "00", overdue: false });
    expect(orderElapsedTime({ createdAt: START, servedAt: null }, now)).toEqual(
      {
        m: 80,
        ss: "00",
        overdue: true,
      },
    );
  });
});
