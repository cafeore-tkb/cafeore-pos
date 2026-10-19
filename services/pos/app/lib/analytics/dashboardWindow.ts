import { type TimeWindow, dayWindow } from "./operations";

const clockMinutes = (clock: string, end: boolean) => {
  if (end && clock === "24:00") return 1440;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) return null;
  const minutes = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3));
  return minutes % 5 === 0 ? minutes : null;
};
/** 同じJST日の [開始, 終了)。未来の開始・逆転・不正な時刻は集計しない。 */
export function dashboardWindow(
  date: string,
  start: string,
  end: string,
  now: number,
): TimeWindow | null {
  const from = clockMinutes(start, false);
  const to = clockMinutes(end, true);
  const day = dayWindow(date, now);
  if (from === null || to === null || to <= from || !Number.isFinite(day.start))
    return null;
  const window = {
    start: day.start + from * 60_000,
    end: day.start + to * 60_000,
    now,
  };
  return window.start >= now ? null : window;
}
