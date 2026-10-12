import { type CaosCard, caosBrewSec } from "@cafeore/common";
import type { Lane } from "./lanes";

// リベロビュー（/master-sheet/libero）の決まり。リベロ（ドリッパーにお湯を持って回る係）が、入れ始めてからの時間が長い人から回れるよう、
// 抽出中のドリッパーに、経過の長い順の順位と、予定の抽出時間（@cafeore/common の caosBrewSec）に対する進み具合の段を付ける。

/** 進み具合の段の数（予定の抽出時間までを等分する）。段がこの数なら予定の抽出時間を過ぎている */
const LIBERO_STEPS = 4;

/** 抽出中のカードと、その経過（秒）・予定の抽出時間（秒）・経過の長い順の順位（1 から）・進み具合の段（0〜LIBERO_STEPS） */
export interface LiberoBrew {
  card: CaosCard;
  elapsedSec: number;
  plannedSec: number;
  rank: number;
  step: number;
}

/** ドリッパーと、その抽出中のカードの経過。抽出していないドリッパーは brew が無い */
export interface LiberoLane {
  lane: Lane;
  brew?: LiberoBrew;
}

/** ドリッパーごとの抽出中のカードの経過（並びは lanes のまま） */
export const liberoLanes = (
  lanes: readonly Lane[],
  nowMs: number,
): LiberoLane[] => {
  const longest = lanes
    .flatMap(({ brewing }) =>
      brewing?.startedAt
        ? [{ card: brewing, startMs: brewing.startedAt.getTime() }]
        : [],
    )
    .sort(
      (a, b) =>
        a.startMs - b.startMs || (a.card.dripper ?? 0) - (b.card.dripper ?? 0),
    );
  return lanes.map((lane) => {
    const index = longest.findIndex(({ card }) => card === lane.brewing);
    if (index < 0) return { lane };
    const { card, startMs } = longest[index];
    const elapsedSec = Math.max(0, Math.floor((nowMs - startMs) / 1000));
    const plannedSec = caosBrewSec(card.cups.length);
    const step = Math.floor((elapsedSec * LIBERO_STEPS) / plannedSec);
    return {
      lane,
      brew: {
        card,
        elapsedSec,
        plannedSec,
        rank: index + 1,
        step: Math.min(LIBERO_STEPS, step),
      },
    };
  });
};

/** 経過の長い順（抽出中を順位の順に、そのあとに抽出していないドリッパーを番号の順に） */
export const byElapsed = (rows: readonly LiberoLane[]) =>
  [...rows].sort(
    (a, b) =>
      (a.brew?.rank ?? Number.MAX_SAFE_INTEGER) -
        (b.brew?.rank ?? Number.MAX_SAFE_INTEGER) || a.lane.id - b.lane.id,
  );
