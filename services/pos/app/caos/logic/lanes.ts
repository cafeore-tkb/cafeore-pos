import {
  type CaosCard,
  type CaosPlace,
  DRIPPER_NUMBERS,
  assignWrites,
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
 * カード（card）の割当・移動のボタン（1〜6）。押すとそのドリッパーの列の最後へ（今のドリッパー currentBayId でも同じ。current）。
 * 指名の番号のあるカードは、その番号のボタンだけ押せる（disabled。@cafeore/common の caosDripperAllowed）
 */
export const moveTargets = (card: CaosCard, currentBayId: number | null) =>
  DRIPPER_NUMBERS.map((bayId) => ({
    bayId,
    current: bayId === currentBayId,
    disabled: !caosDripperAllowed(card, bayId),
  }));

/**
 * card を dripper の列の place（無ければ待機の最後）に動かしても何も変わらないか（今と同じ場所）。置けないとき（assignWrites が断る）も true。
 * cards はその列のカード（ほかの列のカードが混ざっていてもよい）
 */
export const staysInLane = (
  cards: readonly CaosCard[],
  card: CaosCard,
  dripper: number,
  place?: CaosPlace,
) => {
  const result = assignWrites(cards, card, dripper, { place, newId: () => "" });
  return "error" in result || result.writes.length === 0;
};

/**
 * 待機・抽出中のカードを、今のドリッパーの列（lane）の先頭（"front"）・待機の先頭（"queueFront"。抽出中のすぐ後ろ）へ動かすボタン。
 * 動かしても今と同じ場所なら押せない（抽出中のカードの「先頭」・もう待機の先頭にあるカードの「待機の先頭」）。置けないとき（assignWrites が断る）も押せない
 * （@cafeore/common の assignWrites で確かめる）。bayId はその列（押したら onPick・onMoveTicket に渡す）。
 * 添え書き（hint）は列に抽出中があるときだけ（先頭は今から始まり、待機の先頭は抽出中の次。抽出中が無ければどちらも待機の先頭（未着手）で、▶ で始める）
 */
export const frontTargets = (card: CaosCard, lane: Lane) => {
  const stays = (place: CaosPlace) =>
    staysInLane(laneActive(lane), card, lane.id, place);
  const brewing = lane.brewing !== undefined;
  return [
    {
      place: "front" as const,
      label: "先頭",
      hint: brewing ? "今から始める" : undefined,
      disabled: stays("front"),
    },
    {
      place: "queueFront" as const,
      label: "待機の先頭",
      hint: brewing ? "抽出中の次" : undefined,
      disabled: stays("queueFront"),
    },
  ].map((target) => ({ ...target, bayId: lane.id }));
};

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

/** ドラッグで列のカードの上に落としたときに、そのカードのどこに入れるか（前・後ろ・統合） */
export type DropSide = "before" | "after" | "merge";

/** カードの左右の端の幅（カードの幅に対する割合）。左の端はそのカードの前、右の端は後ろ、間は統合（統合できる相手のときだけ） */
export const DROP_EDGE = 0.3;

/**
 * カードの上の横の位置（左の縁から右の縁までを 0〜1。fraction）から、前・後ろ・統合を決める。
 * 左の DROP_EDGE は前、右の DROP_EDGE は後ろ、間は統合できる（mergeable）なら統合、できなければ近いほうの端（前か後ろ）。
 * placeable が false（そのドリッパーに置けない。指名）なら、統合できればカードのどこでも統合、できなければ null
 */
export const dropSideAt = (
  fraction: number,
  { mergeable, placeable = true }: { mergeable: boolean; placeable?: boolean },
): DropSide | null => {
  if (!placeable) return mergeable ? "merge" : null;
  if (fraction < DROP_EDGE) return "before";
  if (fraction > 1 - DROP_EDGE) return "after";
  if (mergeable) return "merge";
  return fraction < 0.5 ? "before" : "after";
};
