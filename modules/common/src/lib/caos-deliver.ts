import type { Cup } from "../models/cup";
import type { components } from "../types/api";
import {
  type CaosBoardCup,
  type CaosCard,
  type caosLane,
  caosNextLocked,
} from "./caos-board";

// ドリップ完了の報告（POST /api/caos/drippers/{dripper}/deliver）の決まり。DB や画面を使わない純粋な関数だけを置く。
//
// ドリッパーは淹れたカードを提供へ持って行き、提供に置いた端末で自分のカードを押して報告する。サーバーは
//   - カードが抽出中なら終える（待機の先頭は始めない。始めるのはマスターの CaOS の ▶）
//   - カードのカップ・入れ直しに、届けた時刻（deliveredAt）を付ける
//   - 注文のカップがそろえば呼び出す（準備完了にする）。抽出の要らないカップ（ミルクなど）と、提供で仕上げる種類（needs_finishing）の
//     カップは、提供の画面で準備完了にするまでそろわない（提供が呼び出す）
// カードの状態（未割当・待機・抽出中・終わり）は今までどおり抽出の時刻で決まり、届けた時刻は見ない。

/** 届けた注文をどうしたか（POST /api/caos/drippers/{dripper}/deliver の応答） */
export type CaosDeliverCall = components["schemas"]["CaosDeliverCall"];
export type CaosDeliveredOrder = components["schemas"]["CaosDeliveredOrder"];

/** カップを提供へ届けたか。入れ直しがあれば入れ直しを全部届けたか（API の cupDelivered と同じ） */
export const cupDelivered = (cup: Pick<Cup, "deliveredAt" | "emergencies">) =>
  cup.emergencies.length === 0
    ? cup.deliveredAt !== null
    : cup.emergencies.every((emergency) => emergency.deliveredAt !== null);

// まだ届けていない 1 杯か。カップは準備完了・提供済みなら届けなくてよい（提供が先に呼び出した）。入れ直しは準備完了の時刻を持たない
const awaitsDelivery = (cup: CaosBoardCup) =>
  cup.deliveredAt === null &&
  (cup.emergency || (cup.readyAt === null && cup.servedAt === null));

/** カードに、まだ届けていない杯がある */
export const cardAwaitsDelivery = (card: Pick<CaosCard, "cups">) =>
  card.cups.some(awaitsDelivery);

/** 報告の画面で、ドリッパーの列に出すカード */
export interface CaosDeliverable {
  card: CaosCard;
  /** 抽出中（届けると抽出も終える） */
  brewing: boolean;
  /** まだ報告できない（始めてから CAOS_NEXT_COOLDOWN_SEC 秒たっていない。サーバーも断る） */
  locked: boolean;
}

/**
 * ドリッパーの列（caosLane）で、報告できるカード。淹れた順（終えたカード、抽出中）に並べる：
 *   - いちばん最後に終えたカードで、まだ届けていない杯があるもの（マスターが CaOS の ✓ で先に終えたカード）。
 *     1 人のドリッパーが持って行くのは直前に淹れた 1 枚なので、それより前に終えたカードは出さない（届けていなければ提供が呼び出す）
 *   - 抽出中のカード
 * 待機のカード（まだ始めていない）は報告できない。nowMs はエポックのミリ秒
 */
export const caosDeliverables = (
  lane: ReturnType<typeof caosLane>,
  nowMs: number,
): CaosDeliverable[] => {
  const last = lane.done.reduce<CaosCard | undefined>(
    (latest, card) =>
      latest === undefined ||
      (card.finishedAt?.getTime() ?? 0) >= (latest.finishedAt?.getTime() ?? 0)
        ? card
        : latest,
    undefined,
  );
  return [
    ...(last && cardAwaitsDelivery(last)
      ? [{ card: last, brewing: false, locked: false }]
      : []),
    ...(lane.brewing
      ? [
          {
            card: lane.brewing,
            brewing: true,
            locked: caosNextLocked(lane.brewing, nowMs),
          },
        ]
      : []),
  ];
};

/** 抽出中が無く、待機の先頭がまだ始まっていない列の、そのカード（マスターが ▶ を押し忘れているかもしれない）。無ければ undefined */
export const caosUnstartedHead = (lane: ReturnType<typeof caosLane>) =>
  lane.brewing ? undefined : lane.queued[0];
