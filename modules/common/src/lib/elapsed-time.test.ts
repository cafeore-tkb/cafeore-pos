import { describe, expect, test } from "vitest";
import { elapsedTime, orderElapsedTime } from "./elapsed-time";

const at = (iso: string) => new Date(iso);
const START = at("2026-11-07T10:00:00+09:00");

describe("[unit] elapsedTime", () => {
  test("splits into minutes and seconds", () => {
    expect(elapsedTime(START, at("2026-11-07T10:03:05+09:00"))).toEqual({
      totalSeconds: 185,
      minutes: 3,
      seconds: 5,
      ss: "05",
      overdue: false,
    });
  });

  test("truncates milliseconds", () => {
    const e = elapsedTime(START, at("2026-11-07T10:00:59.999+09:00"));
    expect(e.minutes).toBe(0);
    expect(e.seconds).toBe(59);
  });

  test("becomes overdue at exactly 15 minutes", () => {
    const before = elapsedTime(START, at("2026-11-07T10:14:59.999+09:00"));
    const just = elapsedTime(START, at("2026-11-07T10:15:00+09:00"));
    expect(before.overdue).toBe(false);
    expect(just.overdue).toBe(true);
  });

  test("does not wrap at 60 minutes", () => {
    const e = elapsedTime(START, at("2026-11-07T11:00:00+09:00"));
    expect(e.minutes).toBe(60);
    expect(e.seconds).toBe(0);
    expect(e.overdue).toBe(true);
  });

  test("keeps counting past 90 minutes", () => {
    const e = elapsedTime(START, at("2026-11-07T11:30:30+09:00"));
    expect(e.minutes).toBe(90);
    expect(e.seconds).toBe(30);
    expect(e.overdue).toBe(true);
  });

  test("works across midnight", () => {
    const e = elapsedTime(
      at("2026-11-07T23:50:00+09:00"),
      at("2026-11-08T00:10:15+09:00"),
    );
    expect(e.minutes).toBe(20);
    expect(e.seconds).toBe(15);
    expect(e.overdue).toBe(true);
  });

  test("counts whole days in minutes", () => {
    const e = elapsedTime(START, at("2026-11-08T11:00:00+09:00"));
    expect(e.minutes).toBe(25 * 60);
  });

  test("clamps negative durations to zero", () => {
    expect(elapsedTime(START, at("2026-11-07T09:59:00+09:00"))).toEqual({
      totalSeconds: 0,
      minutes: 0,
      seconds: 0,
      ss: "00",
      overdue: false,
    });
  });
});

describe("[unit] orderElapsedTime", () => {
  test("uses servedAt when served", () => {
    const e = orderElapsedTime(
      { createdAt: START, servedAt: at("2026-11-07T10:05:00+09:00") },
      at("2026-11-07T12:00:00+09:00"),
    );
    expect(e.minutes).toBe(5);
    expect(e.overdue).toBe(false);
  });

  test("uses now when not served", () => {
    const e = orderElapsedTime(
      { createdAt: START, servedAt: null },
      at("2026-11-07T11:20:00+09:00"),
    );
    expect(e.minutes).toBe(80);
    expect(e.overdue).toBe(true);
  });
});

describe("[unit] elapsedTime の ss", () => {
  test("秒を2桁にする", () => {
    const e = elapsedTime(START, at("2026-11-07T11:32:07+09:00"));
    expect(`${e.minutes}:${e.ss}`).toBe("92:07");
    expect(elapsedTime(START, at("2026-11-07T10:00:42+09:00")).ss).toBe("42");
  });
});
