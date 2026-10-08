import type { Barista, OrderTicket } from "../types";
import { compareCards } from "./cards";

// ドリッパーの列の並びと予定時刻

/** 前の抽出が終わってから次の抽出を始めるまでの入れ替えの時間（秒） */
export const CHANGEOVER_SEC = 15;
/** 抽出の残りがこの秒以下なら「まもなく」（画面で目立たせる） */
const SOON_SEC = 15;

// 待機のカードを注文番号の順に並べ、開始の予定時刻を付け直す。
// 抽出中のカードはそのまま先頭に残す。抽出中のカードが無ければ（activateFirst なら必ず）先頭を今から始める。
export const arrangeQueue = (
  queue: OrderTicket[],
  nowSec: number,
  activateFirst = false,
) => {
  const existingActive = !activateFirst
    ? queue.find((ticket) => ticket.status === "brewing")
    : undefined;
  const scheduled = queue
    .filter((ticket) => ticket !== existingActive)
    .sort(compareCards);
  return scheduleQueue(
    existingActive ? [existingActive, ...scheduled] : scheduled,
    nowSec,
  );
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

// ドリッパーの先頭のカードの残り（秒）。カードが無ければ 0
const activeRemainingSec = (barista: Barista, nowSec: number) => {
  const current = barista.queue[0];
  if (!current) return 0;
  if (current.timeRemainingSec !== undefined) return current.timeRemainingSec;
  if (current.endTimeSec !== undefined)
    return Math.max(0, current.endTimeSec - nowSec);
  return current.totalDurationSec;
};

// 抽出中のカードの残りが SOON_SEC 以下（「まもなく」）
const isSoon = (barista: Barista, nowSec: number) =>
  barista.queue[0]?.status === "brewing" &&
  activeRemainingSec(barista, nowSec) <= SOON_SEC;

// 列の今（抽出中のカード・待機のカード・残り・まもなく・予定を過ぎて継続中）
export const laneStatus = (barista: Barista, nowSec: number) => {
  const [current, ...waiting] = barista.queue;
  return {
    current: current as OrderTicket | undefined,
    waiting,
    remainingSec: activeRemainingSec(barista, nowSec),
    soon: isSoon(barista, nowSec),
    overtime: current?.status === "brewing" && current.timeRemainingSec === 0,
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
