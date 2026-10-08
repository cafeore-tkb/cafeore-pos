import { CAOS_DRIPPER_IDS, type CaosCard, caosLane } from "@cafeore/common";

// 列（ドリッパー 1〜6。番号は @cafeore/common の CAOS_DRIPPER_IDS）。列は「1st」〜「6th」と番号だけで呼ぶ。
// 担当者（名前・上級生のみのカードを淹れられる上級生か）は CaOS では作らない（あとでサーバーの盤面と sohosai-shift の予定から出す）。

/** ドリッパーの列。番号（id）と、@cafeore/common の caosLane（終わり・抽出中・待機） */
export type Lane = { id: number } & ReturnType<typeof caosLane>;

/** 6 列のドリッパー */
export const boardLanes = (cards: readonly CaosCard[]): Lane[] =>
  CAOS_DRIPPER_IDS.map((id) => ({ id, ...caosLane(cards, id) }));

/** ドリッパーの番号か（1〜6） */
export const isBayId = (bayId: number) => CAOS_DRIPPER_IDS.includes(bayId);

/** 列の呼び方（1 → 「1st」） */
export const laneOrdinal = (bayId: number) =>
  ["1st", "2nd", "3rd", "4th", "5th", "6th"][bayId - 1] ?? `${bayId}th`;

/**
 * 割当・移動のボタン（1〜6）。待機のカードは、今のドリッパー（currentBayId）のボタンが「先頭」（このドリッパーの待機の先頭へ）。
 * 指名のドリッパーだけに置く決まりは、明細にドリッパーの番号を持たせてから入れる（CaOS6）
 */
export const moveTargets = (currentBayId: number | null) =>
  CAOS_DRIPPER_IDS.map((bayId) => ({
    bayId,
    toFront: bayId === currentBayId,
  }));
