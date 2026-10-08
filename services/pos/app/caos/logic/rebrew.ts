import type { Barista, OrderTicket } from "../types";
import { orderLabel } from "./cards";
import { canPlaceOn } from "./lanes";
import { queueWaitSeconds } from "./queue";

// 緊急の入れ直しのパネルの選び方（置くドリッパーの候補と、差し込む位置）

/** 置くドリッパーの候補（空くまでの短い順）。指名があればその列だけ。限定もいまはどの列でも可 */
export const rebrewCandidates = (baristas: Barista[], ticket: OrderTicket) => {
  const candidates = baristas
    .map((barista) => ({
      barista,
      wait: queueWaitSeconds(barista.queue),
      eligible: canPlaceOn(ticket, barista.id),
    }))
    .sort((a, b) => a.wait - b.wait || a.barista.id - b.barista.id);
  return {
    candidates,
    fastestId: candidates.find((candidate) => candidate.eligible)?.barista.id,
  };
};

/**
 * 置くドリッパーの列の中で、差し込める位置。
 * 抽出中のカードの前には入れない（止めたカードの代わりに今から始めるときと、列が空のときだけ先頭）。
 */
export const rebrewSlots = (
  barista: Barista,
  { replacesCurrent }: { replacesCurrent: boolean },
) => {
  // 止めるカードは列から抜ける
  const queue = replacesCurrent ? barista.queue.slice(1) : barista.queue;
  if (queue.length === 0)
    return [{ index: 0, label: "今すぐ開始", isLast: false }];
  return [
    ...(replacesCurrent
      ? [{ index: 0, label: "中断後、今すぐ開始", isLast: false }]
      : []),
    ...queue.map((previous, offset) => ({
      index: offset + 1,
      label:
        offset === 0 && !replacesCurrent
          ? "現在の抽出の次"
          : `${orderLabel(previous)} ${previous.beanName} の次`,
      isLast: offset === queue.length - 1,
    })),
  ];
};

/** ドリッパーを選んだときの差し込む位置（止めたカードの代わりか、列が空なら先頭、ほかは抽出中の次） */
export const defaultRebrewIndex = (
  barista: Barista,
  { replacesCurrent }: { replacesCurrent: boolean },
) => (replacesCurrent || barista.queue.length === 0 ? 0 : 1);

/** 確定できるか（未割当に置くか、差し込める位置を選んだ） */
export const canConfirmRebrew = (
  targetBayId: number | null,
  insertIndex: number | null,
  slots: { index: number }[],
) => targetBayId === null || slots.some((slot) => slot.index === insertIndex);
