import { DRIPPER_NUMBERS, dripperLabel } from "../models/dripper";
import type { components } from "../types/api";
import { type CaosCard, caosLane } from "./caos-board";

// CaOS（ドリップ管制）のドリッパーの担当者。サーバーが日本時間の日付ごとに持ち（api の caos_lanes）、
// 替えるのは CaOS の画面の「交代」「入れ替え」だけ。全部の画面へは共有の WebSocket の {"type":"caos_lanes"} で届く。
// 上級生かは、交代した時点で画面が sohosai-shift の名簿で判定した値をサーバーに持つ。
//
// 上級生のみのカード（種類の senior_only）は、担当者が上級生のドリッパーにしか置けない（サーバーの PUT /api/caos/cups と同じ決まり）。

export type CaosLane = components["schemas"]["CaosLane"];
export type CaosLanes = components["schemas"]["CaosLanes"];

/** 担当者のいない 6 つ */
export const emptyCaosLanes = (day: string): CaosLanes => ({
  day,
  lanes: DRIPPER_NUMBERS.map(
    (dripper): CaosLane => ({
      dripper,
      name: "",
      senior: false,
      updated_at: null,
    }),
  ),
});

/**
 * 今日（day）の 6 つの担当者。届いたものが別の日のもの（日が変わった）なら担当者なし。
 * 上級生の印は名前のある担当者にだけ付ける
 */
export const todaysCaosLanes = (
  lanes: CaosLanes | null | undefined,
  day: string,
): CaosLane[] =>
  emptyCaosLanes(day).lanes.map((empty) => {
    if (!lanes || lanes.day !== day) return empty;
    const lane = lanes.lanes.find((l) => l.dripper === empty.dripper);
    if (!lane) return empty;
    return { ...lane, senior: lane.senior && lane.name !== "" };
  });

/**
 * カードをそのドリッパーへ置けない理由（上級生のみのカードで、担当者が上級生でない）。置けるなら null。lanes は todaysCaosLanes の担当者。
 * サーバーと同じく、別のドリッパーへ置くときだけ確かめる（同じドリッパーの中の順番の入れ替えは確かめない。
 * 担当者を上級生でない人に替えても、待っていた上級生のみのカードはそのドリッパーに残るので）。
 * 指名（カップの nominatedDripper）のほかのドリッパーへ置けないのは assignWrites が確かめる。両方が効くので、
 * 指名のドリッパーの担当者が上級生でない上級生のみのカードは、どこにも置けない（担当者を上級生に替えれば置ける）
 */
export const seniorOnlyBlock = (
  card: Pick<CaosCard, "seniorOnly" | "dripper" | "cups">,
  dripper: number,
  lanes: readonly CaosLane[],
): string | null => {
  if (!card.seniorOnly || card.dripper === dripper) return null;
  if (lanes.some((lane) => lane.dripper === dripper && lane.senior))
    return null;
  if (card.cups[0]?.nominatedDripper === dripper)
    return `上級生のみのカードは上級生のドリッパーにしか置けません（指名の ${dripperLabel(dripper)} の担当者は上級生ではありません。担当者を上級生に替えると置けます）`;
  return `上級生のみのカードは上級生のドリッパーにしか置けません（${dripperLabel(dripper)} の担当者は上級生ではありません）`;
};

/** そのドリッパーで待っている（まだ始めていない）上級生のみのカードの枚数 */
export const queuedSeniorOnlyCards = (
  cards: readonly CaosCard[],
  dripper: number,
) => caosLane(cards, dripper).queued.filter((card) => card.seniorOnly).length;

/** 交代したあとの担当者（name が空なら担当者なし） */
export type LaneAssignment = Pick<CaosLane, "dripper" | "name" | "senior">;

/**
 * 交代・入れ替えの確認の文。上級生でない人（担当者なしも）にするドリッパーに上級生のみのカードが待っていれば、ドリッパーごとに 1 行。
 * 無ければ空（確かめずに替える）。single なら 1 つのドリッパーの交代（「このドリッパーに」と書く）
 */
export const laneChangeWarnings = (
  cards: readonly CaosCard[],
  changes: readonly LaneAssignment[],
  single: boolean,
): string[] =>
  changes.flatMap((change) => {
    if (change.senior && change.name !== "") return [];
    const count = queuedSeniorOnlyCards(cards, change.dripper);
    if (count === 0) return [];
    const where = single
      ? "このドリッパー"
      : `${dripperLabel(change.dripper)} のドリッパー`;
    const who = change.name
      ? `${change.name}さんは上級生ではありません`
      : "担当者がいなくなります";
    return [`${where}に上級生のみのカードが${count}枚あります（${who}）`];
  });
