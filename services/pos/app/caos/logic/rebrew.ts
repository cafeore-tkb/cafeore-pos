import type { Barista, OrderTicket } from "../types";
import { orderLabel } from "./cards";
import { canPlaceOn } from "./lanes";
import { queueWaitSeconds } from "./queue";

// 緊急の入れ直しのパネルの選び方（置くドリッパーの候補と、差し込む位置）

/** 入れ直しのパネルで選んだもの */
export interface RebrewDecision {
  cupCount: number;
  /** 抽出中のカードを今止める */
  interruptCurrent: boolean;
  /** 入れ直しを置くドリッパー（null なら未割当） */
  targetBayId: number | null;
  /** 置くドリッパーの列の中の位置（rebrewSlots の index） */
  insertIndex: number | null;
}

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

/** 入れ直しの元（抽出中・終わったカードと、そのドリッパー）と、抽出中のカードを今止めるか */
interface RebrewSource {
  ticket: OrderTicket;
  sourceBayId: number;
  interruptCurrent: boolean;
}

/**
 * 置くドリッパー（barista）の列の中で、差し込める位置と、ドリッパーを選んだときの位置。
 * 抽出中のカードの前には入れない。止めたカードの代わりに同じドリッパーで今から始めるときと、列が空のときだけ先頭に入れられる。
 */
export const rebrewSlots = (barista: Barista, source: RebrewSource) => {
  const replacesCurrent =
    source.interruptCurrent &&
    source.ticket.status === "brewing" &&
    barista.id === source.sourceBayId;
  // 止めるカードは列から抜ける
  const queue = replacesCurrent ? barista.queue.slice(1) : barista.queue;
  const canStartNow = queue.length === 0 || replacesCurrent;
  const front = canStartNow
    ? [
        {
          index: 0,
          label: queue.length === 0 ? "今すぐ開始" : "中断後、今すぐ開始",
          isLast: false,
        },
      ]
    : [];
  return {
    slots: [
      ...front,
      ...queue.map((previous, offset) => ({
        index: offset + 1,
        label:
          offset === 0 && !replacesCurrent
            ? "現在の抽出の次"
            : `${orderLabel(previous)} ${previous.beanName} の次`,
        isLast: offset === queue.length - 1,
      })),
    ],
    defaultIndex: canStartNow ? 0 : 1,
  };
};

/** 確定できるか（未割当に置くか、差し込める位置を選んだ） */
export const canConfirmRebrew = (
  targetBayId: number | null,
  insertIndex: number | null,
  slots: { index: number }[],
) => targetBayId === null || slots.some((slot) => slot.index === insertIndex);
