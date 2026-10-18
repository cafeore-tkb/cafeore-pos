import { describe, expect, test } from "vitest";
import { modePeriod } from "./modePeriod";
import { dayWindow } from "./operations";
const now = Date.parse("2026-10-18T14:23:40+09:00");
const review = { start: now - 7200000, end: now - 1800000, now };

describe("利用場面ごとの集計期間", () => {
  test("現場は過去の選択にかかわらず直近60分、5分固定で時計と連動", () => {
    expect(modePeriod("floor", "2025-11-02", 9, review, 60)).toEqual({
      window: { start: now - 3600000, end: now, now },
      intervalMinutes: 5,
    });
    expect(
      modePeriod("floor", "2025-11-02", 9, { ...review, now: now + 10000 }, 15)
        .window.start,
    ).toBe(now - 3600000 + 10000);
  });
  test.each(["owner", "inventory"] as const)(
    "%sはJSTの選択日全体、時刻絞り込みを引き継がない",
    (mode) => {
      expect(modePeriod(mode, "2026-10-17", 9, review, 15)).toEqual({
        window: dayWindow("2026-10-17", now),
        intervalMinutes: 15,
      });
    },
  );
  test.each([0, 10, 23])(
    "引き継ぎは選択日%i時から1時間で日またぎも正しい",
    (hour) => {
      const result = modePeriod("handoff", "2026-10-17", hour, review, 15);
      expect(result.window.start).toBe(
        dayWindow("2026-10-17", now).start + hour * 3600000,
      );
      expect(result.window.end - result.window.start).toBe(3600000);
      expect(result.window.now).toBe(now);
    },
  );
  test("振り返りは任意期間と集計間隔を維持", () => {
    expect(modePeriod("review", "2026-10-18", 10, review, 60)).toEqual({
      window: review,
      intervalMinutes: 60,
    });
  });
  test("現場の直近1時間は日付が変わっても切り捨てない", () => {
    const midnight = Date.parse("2026-10-18T00:10:00+09:00");
    const result = modePeriod(
      "floor",
      "2026-10-18",
      0,
      { ...review, now: midnight },
      15,
    );
    expect(result.window.start).toBe(Date.parse("2026-10-17T23:10:00+09:00"));
  });
});
