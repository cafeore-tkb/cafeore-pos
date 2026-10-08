import type { Barista, OrderTicket } from "../types";
import { timeOfDayLabel } from "./format";
import { CHANGEOVER_SEC } from "./queue";

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

/**
 * 列のカード（終わり・抽出中・待機）を置く時刻。
 * 待機のカードは前のカードの終わりから入れ替えの時間を空けて置き、抽出中のカードは「次へ」を押すまで今まで伸ばす。
 */
export const positionTickets = (barista: Barista, nowSec: number) => {
  const activeTicket = barista.queue[0];
  let cursorSec: number | null = null;
  return [
    ...barista.pastTickets.map((ticket) => ({
      ...ticket,
      status: "completed" as const,
    })),
    ...barista.queue,
  ].map((ticket: OrderTicket) => {
    let startSec = ticket.startTimeSec ?? nowSec;
    if (cursorSec !== null && ticket.status !== "completed")
      startSec = Math.max(startSec, cursorSec + CHANGEOVER_SEC);
    const plannedEndSec = startSec + ticket.totalDurationSec;
    const endSec =
      ticket === activeTicket ? Math.max(plannedEndSec, nowSec) : plannedEndSec;
    if (ticket.status !== "completed") cursorSec = endSec;
    return { ticket, startSec, endSec };
  });
};
