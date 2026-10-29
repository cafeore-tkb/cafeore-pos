import type { CaosCard } from "@cafeore/common";
import type { Lane } from "./lanes";
import { cardBrewSec, laneStatus } from "./queue";

// リベロの固定6列に表示する抽出経過。予定時間は他の盤面と共通にする。

/** 抽出中のカードと、その経過 */
export interface LiberoBrew {
  card: CaosCard;
  /** 入れ始めてからの秒 */
  elapsedSec: number;
  /** 予定の抽出時間（秒） */
  plannedSec: number;
  /** 予定の抽出時間に対する進み具合（0〜1） */
  progress: number;
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
  return lanes.map((lane) => {
    if (!lane.brewing) return { lane };
    const { elapsedMs } = laneStatus(lane, nowMs);
    const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
    const plannedSec = cardBrewSec(lane.brewing, lane);
    const progress = Math.min(1, elapsedSec / plannedSec);
    return {
      lane,
      brew: {
        card: lane.brewing,
        elapsedSec,
        plannedSec,
        progress,
      },
    };
  });
};
