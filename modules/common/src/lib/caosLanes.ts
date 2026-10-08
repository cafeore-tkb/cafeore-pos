import type { components } from "../types/api";
import { CAOS_DRIPPERS, type CaosCard, caosLane } from "./caos-board";

// CaOS（ドリップ管制）のドリッパーの担当者。サーバーが日本時間の日付ごとに持ち（api の caos_lanes）、
// 替えるのは CaOS の画面の「交代」「入れ替え」だけ。全部の画面へは共有の WebSocket の {"type":"caos_lanes"} で届く。
// 上級生（限定を淹れられる人）かは、交代した時点で画面が sohosai-shift の名簿で判定した値をサーバーに持つ。
//
// 限定のカード（種類の senior_only）は、担当者が上級生のドリッパーにしか置けない（サーバーの PUT /api/caos/cups と同じ決まり）。

export type CaosLane = components["schemas"]["CaosLane"];
export type CaosLanes = components["schemas"]["CaosLanes"];

/** ドリッパーの呼び方（1 → 「1st」） */
export const caosLaneOrdinal = (dripper: number) =>
  ["1st", "2nd", "3rd", "4th", "5th", "6th"][dripper - 1] ?? `${dripper}th`;

/** 担当者のいない 6 つ */
export const emptyCaosLanes = (day: string): CaosLanes => ({
  day,
  lanes: Array.from(
    { length: CAOS_DRIPPERS },
    (_, i): CaosLane => ({
      dripper: i + 1,
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

/** 担当者が上級生か（限定を置けるか） */
export const isSeniorLane = (lanes: readonly CaosLane[], dripper: number) =>
  lanes.some(
    (lane) => lane.dripper === dripper && lane.senior && lane.name !== "",
  );

/**
 * カードをそのドリッパーへ置けない理由（限定のカードで、担当者が上級生でない）。置けるなら null。
 * サーバーと同じく、別のドリッパーへ置くときだけ確かめる（同じドリッパーの中の順番の入れ替えは確かめない。
 * 担当者を上級生でない人に替えても、待っていた限定のカードはそのドリッパーに残るので）
 */
export const seniorOnlyBlock = (
  card: Pick<CaosCard, "seniorOnly" | "dripper">,
  dripper: number,
  lanes: readonly CaosLane[],
): string | null => {
  if (!card.seniorOnly || card.dripper === dripper) return null;
  if (isSeniorLane(lanes, dripper)) return null;
  return `限定のカードは上級生のドリッパーにしか置けません（${caosLaneOrdinal(dripper)} の担当者は上級生ではありません）`;
};

/** そのドリッパーで待っている（まだ始めていない）限定のカードの枚数 */
export const queuedSeniorOnlyCards = (
  cards: readonly CaosCard[],
  dripper: number,
) => caosLane(cards, dripper).queued.filter((card) => card.seniorOnly).length;

/** 交代したあとの担当者（name が空なら担当者なし） */
export interface LaneAssignment {
  dripper: number;
  name: string;
  senior: boolean;
}

/**
 * 交代・入れ替えの確認の文。上級生でない人（担当者なしも）にするドリッパーに限定のカードが待っていれば、ドリッパーごとに 1 行。
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
      : `${caosLaneOrdinal(change.dripper)} のドリッパー`;
    const who = change.name
      ? `${change.name}さんは上級生ではありません`
      : "担当者がいなくなります";
    return [`${where}に限定のカードが${count}枚あります（${who}）`];
  });
