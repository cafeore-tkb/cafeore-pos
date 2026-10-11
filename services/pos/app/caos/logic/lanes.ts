import {
  type CaosBrewTimes,
  type CaosCard,
  DRIPPER_NUMBERS,
  caosDripperAllowed,
  caosLane,
} from "@cafeore/common";

// 列（ドリッパー 1〜6。番号は @cafeore/common の DRIPPER_NUMBERS）。列は「1st」〜「6th」と番号だけで呼ぶ（dripperLabel）。
// 担当者（名前・上級生のみのカードを淹れられる上級生か）は CaOS では作らない（あとでサーバーの盤面と sohosai-shift の予定から出す）。

/** ドリッパーの列。番号（id）と、@cafeore/common の caosLane（終わり・抽出中・待機）と、予定の時刻に使う抽出時間の実測（brewTimes） */
export type Lane = { id: number; brewTimes: CaosBrewTimes } & ReturnType<
  typeof caosLane
>;

/** 6 列のドリッパー。brewTimes は抽出時間の実測（useCaosBrewTimes。無ければ初めの値で予定を立てる） */
export const boardLanes = (
  cards: readonly CaosCard[],
  brewTimes: CaosBrewTimes,
): Lane[] =>
  DRIPPER_NUMBERS.map((id) => ({ id, brewTimes, ...caosLane(cards, id) }));

/** 列の終わっていないカード（抽出中・待機の順） */
export const laneActive = (lane: Lane) =>
  lane.brewing ? [lane.brewing, ...lane.queued] : lane.queued;

/** 列のカード（終わり・抽出中・待機の順） */
export const laneCards = (lane: Lane) => [...lane.done, ...laneActive(lane)];

/** ドリッパーの番号か（1〜6） */
export const isBayId = (bayId: number) => DRIPPER_NUMBERS.includes(bayId);

/**
 * カード（card）の割当・移動のボタン（1〜6）。待機のカードは、今のドリッパー（currentBayId）のボタンが「先頭」（place が "front"。このドリッパーの待機の先頭へ）。
 * 指名の番号のあるカードは、その番号のボタンだけ押せる（disabled。@cafeore/common の caosDripperAllowed）
 */
export const moveTargets = (card: CaosCard, currentBayId: number | null) =>
  DRIPPER_NUMBERS.map((bayId) => ({
    bayId,
    place: bayId === currentBayId ? ("front" as const) : undefined,
    disabled: !caosDripperAllowed(card, bayId),
  }));
