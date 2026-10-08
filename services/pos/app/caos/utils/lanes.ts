import { STANDBY_LABEL } from "@cafeore/common";
import type { Barista } from "../types";

// 列（ドリッパー 1〜6）。列は「1st」〜「6th」と番号で呼ぶ。
// 担当者（名前・限定を淹れられる上級生か）はサーバーが持ち、見出しの番号の横に出す（lanes/ の CaosLanesProvider と LaneName）。

export const BAY_IDS = [1, 2, 3, 4, 5, 6] as const;

/** 列の呼び方（1 → 「1st」） */
export const laneOrdinal = (bayNumber: number) =>
  ["1st", "2nd", "3rd", "4th", "5th", "6th"][bayNumber - 1] ?? `${bayNumber}th`;

/** カードの無い 6 列（初期状態・リセット・実データテストの開始） */
export const makeLaneBaristas = (): Barista[] =>
  BAY_IDS.map(
    (id): Barista => ({
      id,
      bayNumber: id,
      status: "standby",
      remainingStr: STANDBY_LABEL,
      queue: [],
      pastTickets: [],
    }),
  );
