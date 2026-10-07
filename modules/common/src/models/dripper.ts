import { z } from "zod";

/**
 * 指名できるドリッパーの番号。1st〜6th を 1〜6 で持つ
 */
export const DRIPPER_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

export const dripperSchema = z
  .number()
  .int()
  .min(DRIPPER_NUMBERS[0])
  .max(DRIPPER_NUMBERS[DRIPPER_NUMBERS.length - 1]);

const ORDINAL_SUFFIXES: Record<number, string> = { 1: "st", 2: "nd", 3: "rd" };

/**
 * ドリッパーの番号の表示（1 → "1st"、4 → "4th"）
 */
export const dripperLabel = (dripper: number): string =>
  `${dripper}${ORDINAL_SUFFIXES[dripper] ?? "th"}`;

type Assignment = { dripper: number | null; assignee: string | null };

/**
 * マスター・提供など内部で出す指名。番号で出す。
 * 番号より前の注文（自由記述だけの指名）は自由記述を出す。指名なしは null
 */
export const assignmentDisplay = ({
  dripper,
  assignee,
}: Assignment): string | null =>
  dripper !== null ? dripperLabel(dripper) : assignee;

/**
 * ラベルに印刷する指名。自由記述があればその文、無ければ番号（"1st" など）。指名なしは null
 */
export const assignmentLabelText = ({
  dripper,
  assignee,
}: Assignment): string | null =>
  assignee ?? (dripper !== null ? dripperLabel(dripper) : null);
