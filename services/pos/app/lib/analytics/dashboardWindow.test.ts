import { describe, expect, test } from "vitest";
import { dashboardWindow } from "./dashboardWindow";
import { operationsReport } from "./operations";
const now = Date.parse("2026-10-19T15:00:00+09:00");
describe("unit dashboard time filter", () => {
  test("JSTの時刻と24:00を絶対時刻にし、終了を含めない", () => {
    const window = dashboardWindow("2026-10-18", "23:55", "24:00", now);
    if (!window) throw new Error("valid window missing");
    expect(window.start).toBe(Date.parse("2026-10-18T23:55:00+09:00"));
    expect(window.end).toBe(Date.parse("2026-10-19T00:00:00+09:00"));
    const order = (id: string, created: number) => ({
      id,
      number: 1,
      created,
      cancelled: null,
      revenue: 500,
      cups: [],
      comments: [],
    });
    expect(
      operationsReport(
        [order("start", window.start), order("end", window.end)],
        window,
      ).revenue,
    ).toBe(500);
  });
  test("今日の未来分は現在で打ち切り、指定した終了時刻は保持する", () => {
    const window = dashboardWindow("2026-10-19", "14:00", "18:00", now);
    if (!window) throw new Error("valid window missing");
    expect(window.end).toBe(Date.parse("2026-10-19T18:00:00+09:00"));
    expect(operationsReport([], window).buckets.at(-1)?.at).toBeLessThan(now);
  });
  test("逆転・同時刻・未来開始・5分刻みでない時刻をエラーにする", () => {
    for (const [date, start, end] of [
      ["2026-10-19", "11:00", "10:00"],
      ["2026-10-19", "10:00", "10:00"],
      ["2026-10-19", "15:00", "16:00"],
      ["2026-10-20", "00:00", "24:00"],
      ["2026-10-19", "24:00", "24:00"],
      ["2026-10-19", "10:01", "11:00"],
      ["2026-10-19", "10:00", "25:00"],
    ])
      expect(dashboardWindow(date, start, end, now)).toBeNull();
  });
});
