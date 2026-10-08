import { timeOfDayLabel } from "./format";
import type { Lane } from "./lanes";
import { laneTimes } from "./queue";

// 管制盤 A のタイムライン（時刻の目盛りと、カードを置く時刻）

/** 表示する範囲。今の時の 1 時間前から 13 時間（時をまたいだ抽出も本当の位置に出す） */
export const timelineRange = (nowSec: number) => {
  const startSec = Math.floor(nowSec / 3600) * 3600 - 3600;
  return { startSec, endSec: startSec + 13 * 3600 };
};

/** 1 分ごとの目盛り。5 分ごとに時刻（「10:05」）、ほかは分（「:06」） */
export const timeMarkers = (startSec: number, endSec: number) =>
  Array.from({ length: Math.floor((endSec - startSec) / 60) + 1 }, (_, i) => {
    const sec = startSec + i * 60;
    const timeStr = timeOfDayLabel(sec).slice(0, 5);
    const minute = Number(timeStr.slice(3));
    return {
      sec,
      timeStr,
      minuteStr: timeStr.slice(2),
      isMajor: minute % 5 === 0,
      isHour: minute === 0,
    };
  });

/** 列のカードを置く時刻（logic/queue.ts の laneTimes）と、空きスロットを置く時刻（最後のカードの後ろ。今より前には置かない） */
export const positionTickets = (
  lane: Lane,
  nowSec: number,
  dayStartMs: number,
) => {
  const positioned = laneTimes(lane, nowSec, dayStartMs);
  return {
    positioned,
    freeFromSec: Math.max(positioned.at(-1)?.endSec ?? nowSec, nowSec),
  };
};
