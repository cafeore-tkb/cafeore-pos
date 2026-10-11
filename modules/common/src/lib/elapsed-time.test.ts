import { describe, expect, test } from "vitest";
import { orderElapsedTime } from "./elapsed-time";

const at = (time: string) => new Date(`2026-11-07T${time}+09:00`);
const createdAt = at("10:00:00");
// 10:00 に受け付けて、time に提供した注文
const servedAt = (time: string) =>
  orderElapsedTime({ createdAt, servedAt: at(time) });

describe("[unit] orderElapsedTime", () => {
  test("分と2桁の秒に分け、60分で一周しない", () => {
    expect(servedAt("10:03:05")).toEqual({ m: 3, ss: "05", overdue: false });
    expect(servedAt("11:32:07")).toEqual({ m: 92, ss: "07", overdue: true });
  });

  test("15分ちょうどから遅れ", () => {
    expect(servedAt("10:14:59").overdue).toBe(false);
    expect(servedAt("10:15:00").overdue).toBe(true);
  });

  test("提供済みなら提供まで、まだなら now まで", () => {
    const now = at("11:20:00");
    expect(orderElapsedTime({ createdAt, servedAt: null }, now).m).toBe(80);
    expect(
      orderElapsedTime({ createdAt, servedAt: at("10:05:00") }, now).m,
    ).toBe(5);
  });

  test("端末の時計がずれて終わりが受付より前なら 0", () => {
    expect(servedAt("09:59:00")).toEqual({ m: 0, ss: "00", overdue: false });
  });
});
