import { caosBrewSec } from "@cafeore/common";
import type { Lane } from "./lanes";

// リベロビュー（/master-sheet/libero）の決まり。リベロ（ドリッパーにお湯を持って回る係）が、入れ始めてからの時間が長い人から回れるよう、
// 抽出中のドリッパーに、経過の長い順の順位と、予定の抽出時間（@cafeore/common の caosBrewSec）に対する進み具合の段を付ける。

/** 進み具合の段の数（予定の抽出時間までを等分する）。段がこの数なら予定の抽出時間を過ぎている */
export const LIBERO_STEPS = 4;

/** 抽出中のカードの経過（秒）・予定の抽出時間（秒）・経過の長い順の順位（1 から）・進み具合の段（0〜LIBERO_STEPS） */
export interface LiberoBrew {
  elapsedSec: number;
  plannedSec: number;
  rank: number;
  step: number;
}

/** ドリッパーごとの抽出中のカードの経過（並びは lanes のまま）。抽出していないドリッパーは brew が無い */
export const liberoLanes = (lanes: readonly Lane[], nowMs: number) => {
  const startMs = (lane: Lane) => lane.brewing?.startedAt?.getTime();
  const longest = lanes
    .filter((lane) => startMs(lane) !== undefined)
    .sort((a, b) => (startMs(a) ?? 0) - (startMs(b) ?? 0) || a.id - b.id);
  return lanes.map((lane) => {
    const start = startMs(lane);
    if (!lane.brewing || start === undefined) return { lane };
    const elapsedSec = Math.max(0, Math.floor((nowMs - start) / 1000));
    const plannedSec = caosBrewSec(lane.brewing.cups.length);
    const brew: LiberoBrew = {
      elapsedSec,
      plannedSec,
      rank: longest.indexOf(lane) + 1,
      step: Math.min(
        LIBERO_STEPS,
        Math.floor((elapsedSec * LIBERO_STEPS) / plannedSec),
      ),
    };
    return { lane, brew };
  });
};
export type LiberoLane = ReturnType<typeof liberoLanes>[number];

/** 経過の長い順（抽出中を順位の順に、そのあとに抽出していないドリッパーを番号の順に） */
export const byElapsed = (rows: readonly LiberoLane[]) =>
  [...rows].sort(
    (a, b) =>
      (a.brew?.rank ?? Number.MAX_SAFE_INTEGER) -
        (b.brew?.rank ?? Number.MAX_SAFE_INTEGER) || a.lane.id - b.lane.id,
  );
