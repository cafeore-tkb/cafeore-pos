import { DRIPPER_NUMBERS, dripperLabel } from "../models/dripper";
import type { components } from "../types/api";
import { type CaosCard, caosLane, laneActive } from "./caos-board";
import { type ShiftFeed, isSeniorName } from "./caosShiftFeed";

// CaOS（ドリップ管制）のドリッパーの担当者。サーバーが日本時間の日付ごとに持ち（api の caos_lanes）、
// 替えるのは CaOS の画面の「交代」「入れ替え」だけ。全部の画面へは共有の WebSocket の {"type":"caos_lanes"} で届く。
// 上級生かは、交代した時点で画面が sohosai-shift の名簿で判定した値をサーバーに持つ。名簿を読み直したら、今の担当者の分を新しい名簿に合わせる（seniorUpdates）。
//
// 上級生のみのカード（種類の senior_only）も、担当者が上級生でないドリッパーに置ける（サーバーの PUT /api/caos/cups も断らない）。
// 置いたら画面が知らせ、カードに警告の印を出す（nonSeniorPlacement・seniorOnlyOffSenior）。
// 指名のあるカードは指名を優先し、指名のドリッパーの担当者が上級生でなくても知らせない。

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
 * 担当者が上級生のドリッパーに置くはずのカードか。上級生のみで指名の無いカード。
 * 指名のあるカードは指名のドリッパーにしか置けない（assignWrites）ので、その担当者が上級生でなくてもよい（指名が上級生のみより強い）
 */
const needsSeniorLane = (
  card: Pick<CaosCard, "seniorOnly" | "nominatedDripper">,
) => card.seniorOnly && card.nominatedDripper === null;

// ドリッパーの担当者が上級生か（担当者がいなければ上級生でない）
const seniorLane = (dripper: number, lanes: readonly CaosLane[]) =>
  lanes.some((lane) => lane.dripper === dripper && lane.senior);

/**
 * カードをそのドリッパーへ置くと、上級生のみのカード（needsSeniorLane）を上級生でない担当者に置くことになるなら、その担当者。
 * ほかは null（担当者のいないドリッパーも。カードの警告の印だけ出す）。lanes は todaysCaosLanes の担当者。
 * 置くのは止めず（サーバーも断らない）、画面が置いたあとに知らせる。別のドリッパーへ置くときだけ（同じドリッパーの中の順番の入れ替えでは知らせ直さない）
 */
export const nonSeniorPlacement = (
  card: Pick<CaosCard, "seniorOnly" | "dripper" | "nominatedDripper">,
  dripper: number,
  lanes: readonly CaosLane[],
): CaosLane | null => {
  if (!needsSeniorLane(card) || card.dripper === dripper) return null;
  const lane = lanes.find((l) => l.dripper === dripper);
  return lane && lane.name !== "" && !lane.senior ? lane : null;
};

/**
 * card を into に統合したときの nonSeniorPlacement。統合したあとのカード（指名はどちらかの指名）を into のドリッパーに置くとみる。
 * into が未割当なら null
 */
export const nonSeniorMerge = (
  card: Pick<CaosCard, "seniorOnly" | "dripper" | "nominatedDripper">,
  into: Pick<CaosCard, "dripper" | "nominatedDripper">,
  lanes: readonly CaosLane[],
) =>
  into.dripper === null
    ? null
    : nonSeniorPlacement(
        {
          ...card,
          nominatedDripper: card.nominatedDripper ?? into.nominatedDripper,
        },
        into.dripper,
        lanes,
      );

/** 上級生のみのカード（needsSeniorLane）が、担当者が上級生でない（担当者なしも）ドリッパーで待っている・抽出中か（カードに警告の印を出す） */
export const seniorOnlyOffSenior = (
  card: Pick<
    CaosCard,
    "seniorOnly" | "dripper" | "nominatedDripper" | "status"
  >,
  lanes: readonly CaosLane[],
) =>
  needsSeniorLane(card) &&
  card.dripper !== null &&
  (card.status === "queued" || card.status === "brewing") &&
  !seniorLane(card.dripper, lanes);

/** そのドリッパーの抽出中・待機の、上級生のドリッパーに置くはずのカード（needsSeniorLane）の枚数 */
export const activeSeniorOnlyCards = (
  cards: readonly CaosCard[],
  dripper: number,
) => laneActive(caosLane(cards, dripper)).filter(needsSeniorLane).length;

/** 交代したあとの担当者（name が空なら担当者なし） */
export type LaneAssignment = Pick<CaosLane, "dripper" | "name" | "senior">;

/**
 * 交代・入れ替えの知らせの文。上級生でない人（担当者なしも）にするドリッパーに、指名の無い上級生のみのカード（抽出中・待機。警告の印と同じ）があれば、
 * ドリッパーごとに 1 行。無ければ空。替えるのは止めない。single なら 1 つのドリッパーの交代（「このドリッパーに」と書く）
 */
export const laneChangeWarnings = (
  cards: readonly CaosCard[],
  changes: readonly LaneAssignment[],
  single: boolean,
): string[] =>
  changes.flatMap((change) => {
    if (change.senior && change.name !== "") return [];
    const count = activeSeniorOnlyCards(cards, change.dripper);
    if (count === 0) return [];
    const where = single
      ? "このドリッパー"
      : `${dripperLabel(change.dripper)} のドリッパー`;
    const who = change.name
      ? `${change.name}さんは上級生ではありません`
      : "担当者がいなくなります";
    return [
      `${where}に指名の無い上級生のみのカードが${count}枚あります（${who}）`,
    ];
  });

/**
 * sohosai-shift の上級生の名簿（feed の seniors）で判定し直すと、上級生かが変わる今の担当者（名前は変えない）。lanes は todaysCaosLanes の担当者。
 * 予定が無い・名簿が空なら空（読めなかっただけで全員を上級生から外さないよう）
 */
export const seniorUpdates = (
  lanes: readonly CaosLane[],
  feed: ShiftFeed | null,
): LaneAssignment[] => {
  if (!feed || feed.seniors.length === 0) return [];
  return lanes.flatMap(({ dripper, name, senior }) =>
    name && isSeniorName(feed, name) !== senior
      ? [{ dripper, name, senior: !senior }]
      : [],
  );
};
