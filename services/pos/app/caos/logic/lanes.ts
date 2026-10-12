import {
  type CaosCard,
  DRIPPER_NUMBERS,
  caosDripperAllowed,
  caosLane,
  dripperLabel,
  laneActive,
} from "@cafeore/common";
import { totalCups } from "./cards";

// 列（ドリッパー 1〜6。番号は @cafeore/common の DRIPPER_NUMBERS）。列は「1st」〜「6th」と番号だけで呼ぶ（dripperLabel）。
// 担当者（名前・上級生のみのカードを淹れられる上級生か）は CaOS では作らない（あとでサーバーの盤面と sohosai-shift の予定から出す）。

/** ドリッパーの列。番号（id）と、@cafeore/common の caosLane（終わり・抽出中・待機） */
export type Lane = { id: number } & ReturnType<typeof caosLane>;

/** 6 列のドリッパー */
export const boardLanes = (cards: readonly CaosCard[]): Lane[] =>
  DRIPPER_NUMBERS.map((id) => ({ id, ...caosLane(cards, id) }));

// 列の終わっていないカード（抽出中・待機の順）は @cafeore/common の laneActive（画面の部品はここから使う）
export { laneActive };

/** 列のカード（終わり・抽出中・待機の順） */
export const laneCards = (lane: Lane) => [...lane.done, ...laneActive(lane)];

/** ドリッパーの番号か（1〜6） */
export const isBayId = (bayId: number) => DRIPPER_NUMBERS.includes(bayId);

/**
 * カード（card）の割当・移動のボタン（1〜6）。待機・抽出中のカードは、今のドリッパー（currentBayId）のボタンが「先頭」
 * （place が "front"。このドリッパーの列の先頭で、今から始まる。抽出中のカードは今が先頭なので押せない）。
 * 指名の番号のあるカードは、その番号のボタンだけ押せる（disabled。@cafeore/common の caosDripperAllowed）
 */
export const moveTargets = (card: CaosCard, currentBayId: number | null) =>
  DRIPPER_NUMBERS.map((bayId) => ({
    bayId,
    place: bayId === currentBayId ? ("front" as const) : undefined,
    disabled:
      !caosDripperAllowed(card, bayId) ||
      (bayId === currentBayId && card.status === "brewing"),
  }));

/** そのドリッパーをまだ待っている指名の杯数（未割当のうち、指名の番号がそのドリッパーのカード） */
export const pendingNominatedCups = (
  unassigned: readonly CaosCard[],
  dripper: number,
) =>
  totalCups(
    unassigned.filter((card) => card.cups[0].nominatedDripper === dripper),
  );

/** ドリッパーに置いたカードの場所（「3rd 抽出中」「3rd 2番目」「3rd 済」）。キーはカードの key */
export const cardPlaces = (lanes: readonly Lane[]) =>
  new Map(
    lanes.flatMap((lane) => {
      const label = dripperLabel(lane.id);
      return [
        ...lane.done.map((card) => [card.key, `${label} 済`] as const),
        ...(lane.brewing
          ? [[lane.brewing.key, `${label} 抽出中`] as const]
          : []),
        ...lane.queued.map(
          (card, index) => [card.key, `${label} ${index + 1}番目`] as const,
        ),
      ];
    }),
  );
