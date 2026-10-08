import { CAOS_DRIPPER_IDS } from "@cafeore/common";
import type { Barista } from "../types";

// 列（ドリッパー 1〜6。番号は @cafeore/common の CAOS_DRIPPER_IDS）。列は「1st」〜「6th」と番号だけで呼ぶ。
// 担当者（名前・限定を淹れられる上級生か）は CaOS では作らない（あとでサーバーの盤面と sohosai-shift の予定から出す）。

/** 列の呼び方（1 → 「1st」） */
export const laneOrdinal = (bayNumber: number) =>
  ["1st", "2nd", "3rd", "4th", "5th", "6th"][bayNumber - 1] ?? `${bayNumber}th`;

/** ドリッパーの番号か（1〜6） */
const isLaneId = (bayId: number) => CAOS_DRIPPER_IDS.includes(bayId);

/** カードの無い 6 列（初期状態・リセット・実データテストの開始） */
export const makeLaneBaristas = (): Barista[] =>
  CAOS_DRIPPER_IDS.map(
    (id): Barista => ({
      id,
      bayNumber: id,
      queue: [],
      pastTickets: [],
    }),
  );

/**
 * カードの移動のボタン（1〜6）。今のドリッパーのボタンは「先頭」（このドリッパーの待機の先頭へ）。
 * 指名のドリッパーのあるカード（preferredBaristaId。今は入らない。CaOS6 で明細の dripper から入れる）は、そのボタンだけ押せる。
 */
export const moveTargets = (
  preferredBaristaId: number | undefined,
  currentBayId: number | null,
) =>
  CAOS_DRIPPER_IDS.map((bayId) => ({
    bayId,
    toFront: bayId === currentBayId,
    disabled: Boolean(preferredBaristaId && preferredBaristaId !== bayId),
  }));

/**
 * ドラッグで指の下にあるドリッパー（data-bay-target を持つ列・1〜6 のボタン）。管制盤 A・C・D で共通。
 * 1〜6 のボタンが下にあれば、そのボタンだけで決める（下の列に落ちない）。
 * 列は from（移す前のドリッパー。運んでいるカード自身がその列の中にある）を飛ばして探す。
 * from と、指名のドリッパー以外（preferred）は置けないので null。
 */
export const bayTargetAt = (
  clientX: number,
  clientY: number,
  { from, preferred }: { from?: number; preferred?: number } = {},
) => {
  const elements = document.elementsFromPoint(clientX, clientY);
  const bayOf = (element: HTMLElement | null | undefined) =>
    Number(element?.dataset.bayTarget);
  const button = elements.find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.matches("button[data-bay-target]"),
  );
  const bayId = button
    ? bayOf(button)
    : bayOf(
        elements
          .map((element) => element.closest<HTMLElement>("[data-bay-target]"))
          .find((element) => {
            const id = bayOf(element);
            return isLaneId(id) && id !== from;
          }),
      );
  if (!isLaneId(bayId) || bayId === from) return null;
  if (preferred && preferred !== bayId) return null;
  return bayId;
};
