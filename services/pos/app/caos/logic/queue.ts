import type { Barista, OrderTicket } from "../types";
import { compareCards } from "./cards";

// ドリッパーの列の並びと予定時刻

/** 前の抽出が終わってから次の抽出を始めるまでの入れ替えの時間（秒） */
export const CHANGEOVER_SEC = 15;
/** 抽出の残りがこの秒以下なら「まもなく」（画面で目立たせる） */
const SOON_SEC = 15;

// 待機のカードを注文番号の順に並べ、開始の予定時刻を付け直す。
// 抽出中のカードはそのまま先頭に残す。抽出中のカードが無ければ先頭を今から始める。
export const arrangeQueue = (queue: OrderTicket[], nowSec: number) => {
  const brewing = queue.filter((ticket) => ticket.status === "brewing");
  const waiting = queue
    .filter((ticket) => ticket.status !== "brewing")
    .sort(compareCards);
  return scheduleQueue([...brewing, ...waiting], nowSec);
};

// 並びはそのままで、開始の予定時刻を付け直す。先頭が抽出中でなければ今から始める
export const scheduleQueue = (queue: OrderTicket[], nowSec: number) => {
  if (queue.length === 0) return queue;
  const [head, ...rest] = queue;
  const first: OrderTicket =
    head.status === "brewing"
      ? head
      : {
          ...head,
          status: "brewing",
          startTimeSec: nowSec,
          timeRemainingSec: head.totalDurationSec,
        };
  let cursor = Math.max(
    nowSec,
    (first.startTimeSec ?? nowSec) + first.totalDurationSec,
  );
  return [
    first,
    ...rest.map((ticket): OrderTicket => {
      const startTimeSec = cursor + CHANGEOVER_SEC;
      cursor = startTimeSec + ticket.totalDurationSec;
      return {
        ...ticket,
        status: "scheduled",
        startTimeSec,
        timeRemainingSec: undefined,
      };
    }),
  ];
};

// ドリッパーが待機まで淹れ終えるまでの秒（入れ替えの時間を含む）
export const queueWaitSeconds = (queue: OrderTicket[]) =>
  queue.reduce(
    (sum, ticket, index) =>
      sum +
      (index === 0
        ? (ticket.timeRemainingSec ?? ticket.totalDurationSec)
        : ticket.totalDurationSec + CHANGEOVER_SEC),
    0,
  );

// 次に空くドリッパー（空くまでの秒の短い順に 3 つ）。管制盤 A・C の「次に空く」
export const nextAvailableBays = (baristas: Barista[]) =>
  baristas
    .map((barista) => ({
      bayId: barista.id,
      seconds: queueWaitSeconds(barista.queue),
      isStandby: barista.queue.length === 0,
    }))
    .sort((a, b) => a.seconds - b.seconds || a.bayId - b.bayId)
    .slice(0, 3);
export type NextAvailable = ReturnType<typeof nextAvailableBays>;

// 先頭のカードの残り（秒）
const remainingOf = (ticket: OrderTicket, nowSec: number) => {
  if (ticket.timeRemainingSec !== undefined) return ticket.timeRemainingSec;
  if (ticket.endTimeSec !== undefined)
    return Math.max(0, ticket.endTimeSec - nowSec);
  return ticket.totalDurationSec;
};

// 列の今（抽出中のカード・待機のカード・残りの秒・まもなく（残りが SOON_SEC 以下）・予定を過ぎて継続中）
export const laneStatus = (barista: Barista, nowSec: number) => {
  const [current, ...waiting] = barista.queue as [
    OrderTicket | undefined,
    ...OrderTicket[],
  ];
  const remainingSec = current ? remainingOf(current, nowSec) : 0;
  const brewing = current?.status === "brewing";
  return {
    current,
    waiting,
    remainingSec,
    soon: brewing && remainingSec <= SOON_SEC,
    overtime: brewing && current?.timeRemainingSec === 0,
  };
};

// 抽出中のカードの残りを stepSec 減らす（0 で止める。「次へ」を押すまで終わらない）
export const tickBrewing = (baristas: Barista[], stepSec: number) =>
  baristas.map((barista) => {
    const [head, ...rest] = barista.queue;
    if (head?.status !== "brewing" || head.timeRemainingSec === undefined)
      return barista;
    return {
      ...barista,
      queue: [
        {
          ...head,
          timeRemainingSec: Math.max(0, head.timeRemainingSec - stepSec),
        },
        ...rest,
      ],
    };
  });
