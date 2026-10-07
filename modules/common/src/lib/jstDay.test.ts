import { describe, expect, test } from "vitest";
import { jstDate, startOfJstDay } from "./jstDay";

describe("[unit] jstDate", () => {
  test("日本時間の 0:00 で日付が変わる", () => {
    // 2026-10-08 23:59:59 JST = 2026-10-08T14:59:59Z
    expect(jstDate(Date.parse("2026-10-08T14:59:59Z"))).toBe("2026-10-08");
    // 2026-10-09 00:00:00 JST = 2026-10-08T15:00:00Z
    expect(jstDate(Date.parse("2026-10-08T15:00:00Z"))).toBe("2026-10-09");
  });

  test("UTC の 0:00 では変わらない", () => {
    expect(jstDate(Date.parse("2026-10-08T23:59:59Z"))).toBe("2026-10-09");
    expect(jstDate(Date.parse("2026-10-09T00:00:00Z"))).toBe("2026-10-09");
  });
});

describe("[unit] startOfJstDay", () => {
  test("日本時間のその日の 0:00 を返す", () => {
    const start = Date.parse("2026-10-08T15:00:00Z"); // 2026-10-09 00:00 JST
    expect(startOfJstDay(start)).toBe(start);
    expect(startOfJstDay(Date.parse("2026-10-09T08:30:00Z"))).toBe(start);
    expect(startOfJstDay(Date.parse("2026-10-09T14:59:59.999Z"))).toBe(start);
  });

  test("日の始まりの直前は前の日", () => {
    expect(startOfJstDay(Date.parse("2026-10-08T14:59:59.999Z"))).toBe(
      Date.parse("2026-10-07T15:00:00Z"),
    );
  });

  test("jstDate と同じ日になる", () => {
    const ms = Date.parse("2026-11-03T01:23:45Z");
    expect(jstDate(startOfJstDay(ms))).toBe(jstDate(ms));
  });
});
