import { describe, expect, test } from "vitest";
import {
  brewDurationLabel,
  brewDurationSec,
  formatClockOfDay,
  formatMinSec,
  planLane,
} from "./caosTiming";

describe("[unit] brewDurationSec", () => {
  test("1 杯は 135 秒、2 杯は 195 秒", () => {
    expect(brewDurationSec(1)).toBe(135);
    expect(brewDurationSec(2)).toBe(195);
  });
});

describe("[unit] 表示の文字", () => {
  test("抽出時間", () => {
    expect(brewDurationLabel(1)).toBe("2分15秒");
    expect(brewDurationLabel(2)).toBe("3分15秒");
    expect(formatMinSec(brewDurationSec(1))).toBe("2:15");
    expect(formatMinSec(brewDurationSec(2))).toBe("3:15");
  });

  test("m:ss は負を 0 にする", () => {
    expect(formatMinSec(-5)).toBe("0:00");
    expect(formatMinSec(65)).toBe("1:05");
  });

  test("時計は 24 時を越えたら 0 時に戻す", () => {
    expect(formatClockOfDay(10 * 3600 + 5 * 60 + 9)).toBe("10:05:09");
    expect(formatClockOfDay(24 * 3600 + 61)).toBe("00:01:01");
  });
});

describe("[unit] planLane", () => {
  test("抽出中のカードは始めた時刻から抽出時間で終わる見込み", () => {
    const plan = planLane(1000, { startSec: 950, durationSec: 195 }, []);
    expect(plan.brewing).toEqual({
      startSec: 950,
      endSec: 1145,
      remainingSec: 145,
    });
  });

  test("抽出時間を過ぎたら今終わる見込みで、残りは 0", () => {
    const plan = planLane(1200, { startSec: 950, durationSec: 195 }, [135]);
    expect(plan.brewing).toEqual({
      startSec: 950,
      endSec: 1200,
      remainingSec: 0,
    });
    expect(plan.queued).toEqual([{ startSec: 1215, endSec: 1350 }]);
  });

  test("待機カードは入れ替えの 15 秒を挟んで順に始める", () => {
    const plan = planLane(
      1000,
      { startSec: 1000, durationSec: 135 },
      [195, 135],
    );
    expect(plan.queued).toEqual([
      { startSec: 1150, endSec: 1345 },
      { startSec: 1360, endSec: 1495 },
    ]);
  });

  test("抽出中が無いときは、先頭を今から 10 秒後に始める", () => {
    const plan = planLane(1000, undefined, [135, 195]);
    expect(plan.brewing).toBeUndefined();
    expect(plan.queued).toEqual([
      { startSec: 1010, endSec: 1145 },
      { startSec: 1160, endSec: 1355 },
    ]);
  });

  test("開始時刻が分からない抽出中のカードは今から始めた見込み", () => {
    const plan = planLane(1000, { durationSec: 135 }, []);
    expect(plan.brewing).toEqual({
      startSec: 1000,
      endSec: 1135,
      remainingSec: 135,
    });
  });
});
