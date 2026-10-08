import { type CaosCard, caosBrewSec } from "@cafeore/common";
import type { Lane } from "./lanes";

// ドリッパーの列の時刻（盤面の秒。dayStartMs（その日の 0 時）からの秒）。
// 抽出の開始・終了はカップの時刻（サーバーが付ける）で、待機の予定時刻は毎回ここで計算する。

/** 前の抽出が終わってから次の抽出を始めるまでの入れ替えの時間（秒） */
export const CHANGEOVER_SEC = 15;
/** 抽出の残りがこの秒以下なら「まもなく」（画面で目立たせる） */
const SOON_SEC = 15;
/** 抽出中が無い列の待機の先頭を置く、今から先の秒（「次へ」で始める） */
const START_SOON_SEC = 10;

/** 時刻（Date）を盤面の秒に */
export const boardSec = (date: Date, dayStartMs: number) =>
  Math.floor((date.getTime() - dayStartMs) / 1000);

/** カードの抽出時間（秒） */
export const cardBrewSec = (card: CaosCard) => caosBrewSec(card.cups.length);

/** カードを置く時刻（開始・終了の盤面の秒） */
export interface CardTime {
  card: CaosCard;
  startSec: number;
  endSec: number;
}

/**
 * 列のカード（終わり・抽出中・待機の順）と、その開始・終了の時刻。
 * 終わったカードはカップの時刻、抽出中のカードは開始の時刻から抽出時間のぶん（「次へ」を押すまで今まで伸ばす）、
 * 待機は前のカードの終わりから入れ替えの時間を空けて置く。抽出中が無いときは、待機の先頭を少し先に置く
 */
export const laneTimes = (
  lane: Lane,
  nowSec: number,
  dayStartMs: number,
): CardTime[] => {
  const done = lane.done.map((card): CardTime => {
    const endSec = card.finishedAt
      ? boardSec(card.finishedAt, dayStartMs)
      : nowSec;
    const startSec = card.startedAt
      ? boardSec(card.startedAt, dayStartMs)
      : endSec - cardBrewSec(card);
    return { card, startSec, endSec };
  });
  const brewing = lane.brewing && {
    card: lane.brewing,
    startSec: lane.brewing.startedAt
      ? boardSec(lane.brewing.startedAt, dayStartMs)
      : nowSec,
  };
  const current = brewing && {
    ...brewing,
    endSec: Math.max(brewing.startSec + cardBrewSec(brewing.card), nowSec),
  };
  let cursor = current?.endSec ?? nowSec;
  const queued = lane.queued.map((card, index): CardTime => {
    const startSec =
      !current && index === 0
        ? nowSec + START_SOON_SEC
        : cursor + CHANGEOVER_SEC;
    cursor = startSec + cardBrewSec(card);
    return { card, startSec, endSec: cursor };
  });
  return [...done, ...(current ? [current] : []), ...queued];
};

/**
 * 列の今。抽出中のカード（無ければ「次へ」で始める待機の先頭）・そのあとの待機・残りの秒・
 * まもなく（残りが SOON_SEC 以下）・予定を過ぎて継続中
 */
export const laneStatus = (lane: Lane, nowSec: number, dayStartMs: number) => {
  const current = lane.brewing ?? lane.queued[0];
  const waiting = lane.brewing ? lane.queued : lane.queued.slice(1);
  const remainingSec = lane.brewing
    ? Math.max(
        0,
        cardBrewSec(lane.brewing) -
          (nowSec -
            (lane.brewing.startedAt
              ? boardSec(lane.brewing.startedAt, dayStartMs)
              : nowSec)),
      )
    : current
      ? cardBrewSec(current)
      : 0;
  const brewing = Boolean(lane.brewing);
  return {
    current,
    waiting,
    remainingSec,
    soon: brewing && remainingSec <= SOON_SEC,
    overtime: brewing && remainingSec === 0,
  };
};

// ドリッパーが待機まで淹れ終えるまでの秒（入れ替えの時間を含む）
const laneWaitSeconds = (lane: Lane, nowSec: number, dayStartMs: number) => {
  const { current, waiting, remainingSec } = laneStatus(
    lane,
    nowSec,
    dayStartMs,
  );
  if (!current) return 0;
  return waiting.reduce(
    (sum, card) => sum + cardBrewSec(card) + CHANGEOVER_SEC,
    remainingSec,
  );
};

// 次に空くドリッパー（空くまでの秒の短い順に 3 つ）。管制盤 A・C の「次に空く」
export const nextAvailableBays = (
  lanes: Lane[],
  nowSec: number,
  dayStartMs: number,
) =>
  lanes
    .map((lane) => ({
      bayId: lane.id,
      seconds: laneWaitSeconds(lane, nowSec, dayStartMs),
      isStandby: !lane.brewing && lane.queued.length === 0,
    }))
    .sort((a, b) => a.seconds - b.seconds || a.bayId - b.bayId)
    .slice(0, 3);
export type NextAvailable = ReturnType<typeof nextAvailableBays>;
