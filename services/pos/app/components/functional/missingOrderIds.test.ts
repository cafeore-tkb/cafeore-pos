import { describe, expect, test } from "vitest";
import {
  countOrderIds,
  formatOrderIdRange,
  missingOrderIdRanges,
} from "./missingOrderIds";

describe("[unit] missingOrderIdRanges", () => {
  test("from より後、to までで使われていない番号を、続いた番号ごとにまとめる", () => {
    expect(missingOrderIdRanges([10, 11, 13, 17, 18], 10, 18)).toEqual([
      { start: 12, end: 12 },
      { start: 14, end: 16 },
    ]);
  });

  test("from 以下の番号の抜けは数えない", () => {
    expect(missingOrderIdRanges([2, 5, 11, 12], 10, 12)).toEqual([]);
  });

  test("from の次から番号が飛んでいれば、その間も抜け", () => {
    expect(missingOrderIdRanges([15, 16], 10, 16)).toEqual([
      { start: 11, end: 14 },
    ]);
  });

  test("to より後の番号は見ない。to が使われていなければ to も抜け", () => {
    expect(missingOrderIdRanges([11, 20], 10, 13)).toEqual([
      { start: 12, end: 13 },
    ]);
  });

  test("同じ番号が重なっていても、1 つとして数える", () => {
    expect(missingOrderIdRanges([11, 11, 13, 13], 10, 13)).toEqual([
      { start: 12, end: 12 },
    ]);
  });

  test("大きく飛んでも、番号を 1 つずつ数えずに求める", () => {
    expect(
      missingOrderIdRanges([11, 1_000_000_000], 10, 1_000_000_000),
    ).toEqual([{ start: 12, end: 999_999_999 }]);
  });
});

describe("[unit] countOrderIds・formatOrderIdRange", () => {
  test("番号の数と、まとまりの書き方", () => {
    const ranges = [
      { start: 12, end: 12 },
      { start: 14, end: 16 },
    ];
    expect(countOrderIds(ranges)).toBe(4);
    expect(ranges.map(formatOrderIdRange)).toEqual(["No.12", "No.14〜16"]);
  });
});
