import { describe, expect, test } from "vitest";
import {
  OVERDUE_SECONDS,
  elapsedSeconds,
  orderElapsedSeconds,
} from "./elapsed-time";

const at = (iso: string) => new Date(iso);
const START = at("2026-11-07T10:00:00+09:00");

describe("[unit] elapsedSeconds", () => {
  test("counts seconds and truncates milliseconds", () => {
    expect(elapsedSeconds(START, at("2026-11-07T10:03:05+09:00"))).toBe(185);
    expect(elapsedSeconds(START, at("2026-11-07T10:00:59.999+09:00"))).toBe(59);
  });

  test("becomes overdue at exactly 15 minutes", () => {
    expect(
      elapsedSeconds(START, at("2026-11-07T10:14:59.999+09:00")) >=
        OVERDUE_SECONDS,
    ).toBe(false);
    expect(
      elapsedSeconds(START, at("2026-11-07T10:15:00+09:00")) >= OVERDUE_SECONDS,
    ).toBe(true);
  });

  test("does not wrap at 60 minutes and works across midnight and days", () => {
    expect(elapsedSeconds(START, at("2026-11-07T11:30:30+09:00"))).toBe(
      90 * 60 + 30,
    );
    expect(
      elapsedSeconds(
        at("2026-11-07T23:50:00+09:00"),
        at("2026-11-08T00:10:15+09:00"),
      ),
    ).toBe(20 * 60 + 15);
    expect(elapsedSeconds(START, at("2026-11-08T11:00:00+09:00"))).toBe(
      25 * 60 * 60,
    );
  });

  test("clamps negative durations to zero", () => {
    expect(elapsedSeconds(START, at("2026-11-07T09:59:00+09:00"))).toBe(0);
  });
});

describe("[unit] orderElapsedSeconds", () => {
  test("uses servedAt when served, now when not", () => {
    const now = at("2026-11-07T11:20:00+09:00");
    expect(
      orderElapsedSeconds(
        { createdAt: START, servedAt: at("2026-11-07T10:05:00+09:00") },
        now,
      ),
    ).toBe(5 * 60);
    expect(orderElapsedSeconds({ createdAt: START, servedAt: null }, now)).toBe(
      80 * 60,
    );
  });
});
