import { type BucketMinutes, type TimeWindow, dayWindow } from "./operations";

export type DashboardMode =
  | "floor"
  | "owner"
  | "handoff"
  | "inventory"
  | "review";
/** 利用場面の期間を全グラフ・注文記録・操作ログで共有する。 */
export const modePeriod = (
  mode: DashboardMode,
  date: string,
  hour: number,
  review: TimeWindow,
  interval: BucketMinutes,
) => {
  const day = dayWindow(date, review.now);
  if (mode === "floor")
    return {
      window: { start: review.now - 3600000, end: review.now, now: review.now },
      intervalMinutes: 5 as BucketMinutes,
    };
  if (mode === "handoff")
    return {
      window: {
        start: day.start + hour * 3600000,
        end: day.start + (hour + 1) * 3600000,
        now: review.now,
      },
      intervalMinutes: interval,
    };
  if (mode === "owner" || mode === "inventory")
    return { window: day, intervalMinutes: interval };
  return { window: review, intervalMinutes: interval };
};
