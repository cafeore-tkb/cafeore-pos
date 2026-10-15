import { type CaosCard, type CaosCardStatus, jstClock } from "@cafeore/common";
import type { Lane } from "./lanes";
import { laneTimes } from "./queue";

// 管制盤 A のタイムライン（時刻の目盛りと、カードを置く時刻）。時刻はエポックのミリ秒で、
// 横の位置は表示する範囲の始まり（startMs）からの差で決める（日をまたいでもそのまま続く）

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** 表示する範囲。今の時の 1 時間前から 13 時間（時をまたいだ抽出も本当の位置に出す） */
export const timelineRange = (nowMs: number) => {
  const startMs = Math.floor(nowMs / HOUR_MS) * HOUR_MS - HOUR_MS;
  return { startMs, endMs: startMs + 13 * HOUR_MS };
};

/** 1 分ごとの目盛り。5 分ごとに時刻（日本時間の「10:05」）、ほかは分（「:06」） */
export const timeMarkers = (startMs: number, endMs: number) =>
  Array.from(
    { length: Math.floor((endMs - startMs) / MINUTE_MS) + 1 },
    (_, i) => {
      const ms = startMs + i * MINUTE_MS;
      const timeStr = jstClock(ms).slice(0, 5);
      const minute = Number(timeStr.slice(3));
      return {
        ms,
        timeStr,
        minuteStr: timeStr.slice(2),
        isMajor: minute % 5 === 0,
        isHour: minute === 0,
      };
    },
  );

/** 列のカードを置く時刻（logic/queue.ts の laneTimes）と、空きスロットを置く時刻（最後のカードの後ろ。今より前には置かない） */
export const positionTickets = (lane: Lane, nowMs: number) => {
  const positioned = laneTimes(lane, nowMs);
  return {
    positioned,
    freeFromMs: Math.max(positioned.at(-1)?.endMs ?? nowMs, nowMs),
  };
};

type SeenStatus = ReadonlyMap<string, CaosCardStatus>;

// 待機に入った（前に無かったか未割当だった待機のカード）
const queuedIn = (previous: SeenStatus, { key, status }: CaosCard) => {
  const before = previous.get(key);
  return (
    status === "queued" && (before === undefined || before === "unassigned")
  );
};

// 抽出を始めた（前に抽出中でなかった抽出中のカード）
const startedBrewing = (previous: SeenStatus, { key, status }: CaosCard) =>
  status === "brewing" && previous.get(key) !== "brewing";

/**
 * タイムラインに新しく入ったカード（割り当てた・抽出を始めた）の key。previous は前に見たカードの状態（key → status）。
 * 待機のカードは前に無かったか未割当だったもの、抽出中のカードは前に抽出中でなかったもの。
 * 別のドリッパーへ移した・統合したカードは同じ key（dripId）のままなので入らない
 */
export const timelineArrivals = (
  previous: SeenStatus,
  cards: readonly CaosCard[],
) =>
  cards
    .filter(
      (card) => queuedIn(previous, card) || startedBrewing(previous, card),
    )
    .map((card) => card.key);

/** 抽出を始めたカードの key（リベロビューの知らせ。待機に入っただけのカードは入らない） */
export const brewStarts = (previous: SeenStatus, cards: readonly CaosCard[]) =>
  cards
    .filter((card) => startedBrewing(previous, card))
    .map((card) => card.key);
