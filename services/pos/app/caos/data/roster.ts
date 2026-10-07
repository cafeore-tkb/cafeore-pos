import type { Barista } from "../types";

// ドリッパー6人の仮の名簿と、毎正時の自動交代に使う仮のシフト。
// 次の PR で、列を 1st〜6th にして sohosai-shift の担当者を出すように置き換える。

const INITIAL_BARISTAS: Pick<
  Barista,
  "id" | "bayNumber" | "name" | "canHandleSpecial" | "iconType"
>[] = [
  {
    id: 1,
    bayNumber: 1,
    name: "鈴木",
    canHandleSpecial: true,
    iconType: "cup",
  },
  { id: 2, bayNumber: 2, name: "中村", iconType: "cup" },
  { id: 3, bayNumber: 3, name: "高橋", iconType: "clock" },
  { id: 4, bayNumber: 4, name: "田中", iconType: "snowflake" },
  { id: 5, bayNumber: 5, name: "伊藤", iconType: "cup" },
  {
    id: 6,
    bayNumber: 6,
    name: "山口",
    canHandleSpecial: true,
    iconType: "cup",
  },
];

/** 全員が空のドリッパー6人（初期状態・リセット・閲覧のみの盤面） */
export const makeCleanBaristas = (): Barista[] =>
  INITIAL_BARISTAS.map(
    (barista): Barista => ({
      ...barista,
      status: "standby",
      remainingStr: "00:00 待機中",
      queue: [],
      pastTickets: [],
    }),
  );

export type ShiftMember = { name: string; canHandleSpecial: boolean };

export const SHIFT_ROSTERS: ShiftMember[][] = [
  [
    { name: "鈴木", canHandleSpecial: true },
    { name: "山口", canHandleSpecial: true },
    { name: "小林", canHandleSpecial: false },
    { name: "松本", canHandleSpecial: false },
    { name: "井上", canHandleSpecial: false },
    { name: "木村", canHandleSpecial: false },
  ],
  [
    { name: "林", canHandleSpecial: true },
    { name: "中西", canHandleSpecial: true },
    { name: "近藤", canHandleSpecial: true },
    { name: "斎藤", canHandleSpecial: false },
    { name: "清水", canHandleSpecial: false },
    { name: "山本", canHandleSpecial: false },
  ],
  [
    { name: "森", canHandleSpecial: true },
    { name: "橋本", canHandleSpecial: false },
    { name: "阿部", canHandleSpecial: false },
    { name: "石川", canHandleSpecial: false },
    { name: "山下", canHandleSpecial: false },
    { name: "藤田", canHandleSpecial: false },
  ],
  [
    { name: "沼田", canHandleSpecial: true },
    { name: "佐藤", canHandleSpecial: true },
    { name: "三田", canHandleSpecial: true },
    { name: "前田", canHandleSpecial: false },
    { name: "岡田", canHandleSpecial: false },
    { name: "石井", canHandleSpecial: false },
  ],
  [
    { name: "瀬邉", canHandleSpecial: true },
    { name: "菅原", canHandleSpecial: true },
    { name: "長谷川", canHandleSpecial: false },
    { name: "村上", canHandleSpecial: false },
    { name: "坂本", canHandleSpecial: false },
    { name: "青木", canHandleSpecial: false },
  ],
];

/** 限定を淹れられる人を 1 番、2 人目を 6 番に置き、残りを空いた番号へ詰める */
export const placeShiftMembers = (members: ShiftMember[]) => {
  const special = members.filter((member) => member.canHandleSpecial);
  const regular = members.filter((member) => !member.canHandleSpecial);
  const placed: Array<ShiftMember | undefined> = Array(6).fill(undefined);
  if (special[0]) placed[0] = special.shift();
  if (special[0]) placed[5] = special.shift();
  [...special, ...regular].forEach((member) => {
    const openIndex = placed.findIndex((placedMember) => !placedMember);
    if (openIndex >= 0) placed[openIndex] = member;
  });
  return placed as ShiftMember[];
};
