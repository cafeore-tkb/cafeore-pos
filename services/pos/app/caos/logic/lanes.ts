import type { Barista } from "./board";

// 列（ドリッパー 1〜6）。列は「1st」〜「6th」と番号だけで呼ぶ。
// 担当者（名前・限定を淹れられる上級生か）は CaOS では作らない（あとでサーバーの盤面と sohosai-shift の予定から出す）。

const BAY_IDS: readonly number[] = [1, 2, 3, 4, 5, 6];

/** ドリッパーの番号か（1〜6） */
export const isBayId = (bayId: number) => BAY_IDS.includes(bayId);

/** 列の呼び方（1 → 「1st」） */
export const laneOrdinal = (bayId: number) =>
  ["1st", "2nd", "3rd", "4th", "5th", "6th"][bayId - 1] ?? `${bayId}th`;

/** カードの無い 6 列（初期状態・リセット・実データテストの開始） */
export const makeLaneBaristas = (): Barista[] =>
  BAY_IDS.map((id) => ({ id, queue: [], pastTickets: [] }));

/** そのドリッパーに置けるか（指名のあるカードは指名のドリッパーだけ） */
export const canPlaceOn = (
  card: { preferredBaristaId?: number },
  bayId: number,
) => !card.preferredBaristaId || card.preferredBaristaId === bayId;

/** 割当・移動のボタン（1〜6）。今のドリッパー（currentBayId）と、置けないドリッパーは押せない */
export const moveTargets = (
  card: { preferredBaristaId?: number },
  currentBayId: number | null,
) =>
  BAY_IDS.map((bayId) => ({
    bayId,
    disabled: bayId === currentBayId || !canPlaceOn(card, bayId),
  }));
