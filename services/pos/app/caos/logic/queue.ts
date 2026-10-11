import { type CaosCard, caosBrewSec } from "@cafeore/common";
import { type Lane, laneActive } from "./lanes";

// ドリッパーの列の時刻（エポックのミリ秒。日付を含むので、日をまたいでもそのまま続く）。
// 抽出の開始・終了はカップの時刻（サーバーが付ける）で、待機の予定時刻は毎回ここで計算する。
// 「次へ」は前のカードを終えると同時に次のカードを始めるので、カードの時間（cardBrewSec）は入れ替えの時間も含み、待機は前のカードの終わりから続けて置く。
/** 抽出の残りがこの秒以下なら「まもなく」（画面で目立たせる） */
const SOON_SEC = 15;
/** 抽出中が無い列の待機の先頭を置く、今から先の秒（「次へ」で始める） */
const START_SOON_SEC = 10;

/** カードの時間（秒。入れ替えを含む）。抽出時間の実測（全列共通の lane.brewTimes）にその杯数があれば実測、無ければ初めの値 */
export const cardBrewSec = (lane: Lane, card: CaosCard) =>
  caosBrewSec(card.cups.length, lane.brewTimes);

const brewMs = (lane: Lane, card: CaosCard) => cardBrewSec(lane, card) * 1000;

// 抽出中のカードの開始（開始の時刻はサーバーが付ける）
const brewStartMs = (card: CaosCard, nowMs: number) =>
  card.startedAt?.getTime() ?? nowMs;

/** カードを置く時刻（開始・終了。エポックのミリ秒） */
interface CardTime {
  card: CaosCard;
  startMs: number;
  endMs: number;
}

/**
 * 列のカード（終わり・抽出中・待機の順）と、その開始・終了の時刻。
 * 終わったカードはカップの時刻、抽出中のカードは開始の時刻から抽出時間のぶん（「次へ」を押すまで今まで伸ばす）、
 * 待機は前のカードの終わりから続けて置く。抽出中が無いときは、待機の先頭を少し先に置く
 */
export const laneTimes = (lane: Lane, nowMs: number): CardTime[] => {
  const done = lane.done.map((card): CardTime => {
    const endMs = card.finishedAt?.getTime() ?? nowMs;
    const startMs = card.startedAt?.getTime() ?? endMs - brewMs(lane, card);
    return { card, startMs, endMs };
  });
  let current: CardTime | undefined;
  if (lane.brewing) {
    const startMs = brewStartMs(lane.brewing, nowMs);
    current = {
      card: lane.brewing,
      startMs,
      endMs: Math.max(startMs + brewMs(lane, lane.brewing), nowMs),
    };
  }
  let cursor = current?.endMs ?? nowMs;
  const queued = lane.queued.map((card, index): CardTime => {
    const startMs =
      !current && index === 0 ? nowMs + START_SOON_SEC * 1000 : cursor;
    cursor = startMs + brewMs(lane, card);
    return { card, startMs, endMs: cursor };
  });
  return [...done, ...(current ? [current] : []), ...queued];
};

/**
 * 列の状態（ドリッパーの番号の色で出す）。
 * 空き：カードが無い／待機：待機のカードがあり、まだ始めていない（「次へ」で始める）／抽出中／
 * まもなく：残りが SOON_SEC 以下／継続中：予定を過ぎても「次へ」が押されていない
 */
export type LanePhase = "empty" | "waiting" | "brewing" | "soon" | "overtime";

const lanePhase = (
  current: CaosCard | undefined,
  brewing: boolean,
  remainingSec: number,
): LanePhase => {
  if (!current) return "empty";
  if (!brewing) return "waiting";
  if (remainingSec === 0) return "overtime";
  if (remainingSec <= SOON_SEC) return "soon";
  return "brewing";
};

/** 列の今。抽出中のカード（無ければ「次へ」で始める待機の先頭）・そのあとの待機・残り（ミリ秒と、表示の秒）・状態（phase） */
export const laneStatus = (lane: Lane, nowMs: number) => {
  const [current, ...waiting] = laneActive(lane);
  const elapsedMs = lane.brewing ? nowMs - brewStartMs(lane.brewing, nowMs) : 0;
  const remainingMs = current
    ? Math.max(0, brewMs(lane, current) - elapsedMs)
    : 0;
  const remainingSec = Math.ceil(remainingMs / 1000);
  return {
    current,
    waiting,
    remainingMs,
    remainingSec,
    phase: lanePhase(current, Boolean(lane.brewing), remainingSec),
  };
};

export type LaneStatus = ReturnType<typeof laneStatus>;

// ドリッパーが待機まで淹れ終えるまでのミリ秒
const laneWaitMs = (lane: Lane, nowMs: number) => {
  const { current, waiting, remainingMs } = laneStatus(lane, nowMs);
  if (!current) return 0;
  return waiting.reduce((sum, card) => sum + brewMs(lane, card), remainingMs);
};

// 次に空くドリッパー（空くまでの秒の短い順に 3 つ）。管制盤 A・C の「次に空く」
export const nextAvailableBays = (lanes: Lane[], nowMs: number) =>
  lanes
    .map((lane) => ({
      bayId: lane.id,
      seconds: Math.ceil(laneWaitMs(lane, nowMs) / 1000),
      isStandby: !lane.brewing && lane.queued.length === 0,
    }))
    .sort((a, b) => a.seconds - b.seconds || a.bayId - b.bayId)
    .slice(0, 3);
export type NextAvailable = ReturnType<typeof nextAvailableBays>;
