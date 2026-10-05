import type { SquarePaymentType } from "@cafeore/common";

/**
 * 確定欄のボタン。上から並んでいる順
 *
 * Square のボタンは、Square 連携が有効なときだけ出る。
 */
export const SUBMIT_FOCUS_ORDER = [
  "submit",
  "exactPayment",
  "CARD_PRESENT",
  "FELICA_ALL",
  "QR_CODE",
] as const satisfies readonly ("submit" | "exactPayment" | SquarePaymentType)[];

export type SubmitFocusTarget = (typeof SUBMIT_FOCUS_ORDER)[number];

// 狙ったボタンが押せないときに代わりにフォーカスする順。
// 受取金額が足りないときは「お釣り 0」を優先する（今までと同じ）。
const FALLBACK_ORDER: readonly SubmitFocusTarget[] = [
  "exactPayment",
  "submit",
  "CARD_PRESENT",
  "FELICA_ALL",
  "QR_CODE",
];

/**
 * 実際にフォーカスするボタンを決める。押せるボタンが無ければ null
 */
export const resolveSubmitFocus = (
  target: SubmitFocusTarget,
  available: readonly SubmitFocusTarget[],
): SubmitFocusTarget | null => {
  if (available.includes(target)) {
    return target;
  }
  return (
    FALLBACK_ORDER.find((candidate) => available.includes(candidate)) ?? null
  );
};

/**
 * ↑↓キーで、押せるボタンの間を step だけ移動する（端で止まる）
 */
export const moveSubmitFocus = (
  target: SubmitFocusTarget,
  available: readonly SubmitFocusTarget[],
  step: number,
): SubmitFocusTarget => {
  const current = resolveSubmitFocus(target, available);
  if (current === null) {
    return target;
  }
  const ordered = SUBMIT_FOCUS_ORDER.filter((candidate) =>
    available.includes(candidate),
  );
  const index = ordered.indexOf(current);
  const next = Math.min(Math.max(index + step, 0), ordered.length - 1);
  return ordered[next];
};
