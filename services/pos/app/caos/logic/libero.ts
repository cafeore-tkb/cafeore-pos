import { type CaosCard, caosBrewSec } from "@cafeore/common";
import type { Lane } from "./lanes";
import { laneStatus } from "./queue";

// リベロビュー（/master-sheet/libero）の決まり。リベロ（ドリッパーにお湯を持って回る係）が、入れ始めてからの時間が長い人から回れるよう、
// 抽出中のドリッパーに、経過の長い順の順位と、予定の抽出時間（@cafeore/common の caosBrewSec）に対する進み具合の段を付ける。
// 経過と予定を過ぎたか（継続中）は、ほかの画面の列の状態と同じ laneStatus から引く。

/** 進み具合の段（予定の抽出時間までを等分する）。予定の抽出時間を過ぎたら "overtime" */
const LEVELS = [0, 1, 2, 3] as const;
export type LiberoLevel = (typeof LEVELS)[number] | "overtime";

/** 抽出中のカードと、その経過 */
export interface LiberoBrew {
  card: CaosCard;
  /** 入れ始めてからの秒 */
  elapsedSec: number;
  /** 予定の抽出時間（秒） */
  plannedSec: number;
  /** 予定の抽出時間に対する進み具合（0〜1） */
  progress: number;
  /** 予定の抽出時間を過ぎた秒（過ぎていなければ 0） */
  overSec: number;
  /** 経過の長い順の順位（1 から。同じ時刻に始めたら番号の小さいドリッパーが上） */
  rank: number;
  level: LiberoLevel;
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
  // 始めた時刻（まだ無ければ今。laneStatus の経過と同じ）
  const startMs = (lane: Lane) => lane.brewing?.startedAt?.getTime() ?? nowMs;
  const longest = lanes
    .filter((lane) => lane.brewing)
    .sort((a, b) => startMs(a) - startMs(b));
  return lanes.map((lane) => {
    if (!lane.brewing) return { lane };
    const { elapsedMs, phase } = laneStatus(lane, nowMs);
    const elapsedSec = Math.max(0, Math.floor(elapsedMs / 1000));
    const plannedSec = caosBrewSec(lane.brewing.cups.length);
    const progress = Math.min(1, elapsedSec / plannedSec);
    return {
      lane,
      brew: {
        card: lane.brewing,
        elapsedSec,
        plannedSec,
        progress,
        overSec: Math.max(0, elapsedSec - plannedSec),
        rank: longest.indexOf(lane) + 1,
        level:
          phase === "overtime"
            ? "overtime"
            : LEVELS[Math.floor(progress * LEVELS.length)],
      },
    };
  });
};

const UNRANKED = Number.MAX_SAFE_INTEGER;

/** 経過の長い順（抽出中を順位の順に、そのあとに抽出していないドリッパーを番号の順に） */
export const byElapsed = (rows: readonly LiberoLane[]) =>
  [...rows].sort(
    (a, b) => (a.brew?.rank ?? UNRANKED) - (b.brew?.rank ?? UNRANKED),
  );
