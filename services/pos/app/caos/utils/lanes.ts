import { DRIPPER_NUMBERS } from "@cafeore/common";
import type { Barista } from "../types";

// 列（ドリッパー 1〜6。番号は @cafeore/common の DRIPPER_NUMBERS）。列は「1st」〜「6th」と番号で呼ぶ（dripperLabel）。
// 担当者（名前・限定を淹れられる上級生か）はサーバーが持ち、見出しの番号の横に出す（lanes/ の CaosLanesProvider と LaneName）。

/** カードの無い 6 列（初期状態・リセット・実データテストの開始） */
export const makeLaneBaristas = (): Barista[] =>
  DRIPPER_NUMBERS.map(
    (id): Barista => ({
      id,
      bayNumber: id,
      status: "standby",
      queue: [],
      pastTickets: [],
    }),
  );
