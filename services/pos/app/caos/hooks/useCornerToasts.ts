import type { CaosCard, CaosLane } from "@cafeore/common";
import { useEffect, useRef, useState } from "react";

import { caosLog } from "../utils/log";
import { useCaosStateLog } from "./useCaosStateLog";

// 未完了の確認は、非表示にしても解決・取消まで保持する。

/**
 * 抽出中のカードを終えたあとに始めるもの。head は待機の先頭（カードの ✓）、none は何も始めない（カードの ✋）、
 * key はそのカード（未着手のカードの ▶。抽出中は無い）
 */
export type NextStart = "head" | "none" | { key: string };

/**
 * 右上に出す確かめと知らせ（盤面の操作を止めない）
 *   - next（確かめ）：押し間違いかもしれない、抽出中のカードを終える操作（どのドリッパーの、どのカードを、始めてから何秒で終えようとしたか。
 *     start は終えたあとに始めるもの）。［やめる］［次へ進める］（終えるだけなら［終える］）
 *   - lateMerge（知らせ）：抽出を始めてから時間のたったカードへ統合した（card を into へ統合した。into は始めてから何秒か）。統合はもうしてあり、［閉じる］だけ
 *   - seniorOnly（知らせ）：上級生のみのカード（cards。まとめて移したときは何枚も）を、上級生でない担当者（lane）のドリッパーに置いた。［閉じる］だけ
 */
export type CornerToast =
  | {
      kind: "next";
      bayId: number;
      card: CaosCard;
      elapsedSec: number;
      start: NextStart;
    }
  | { kind: "lateMerge"; card: CaosCard; into: CaosCard; elapsedSec: number }
  | { kind: "seniorOnly"; cards: CaosCard[]; lane: CaosLane };

/** 出している確かめ・知らせ（id と関連操作。ops は知らせのもとになった、端末に残した盤面の操作の id） */
export type OpenCornerToast = CornerToast & {
  id: string;
  ops: string[];
};

// 同じものは 1 つ（同じドリッパーの「次へ」・同じカードの統合・同じカードを置いたのをもう一度すれば置き換える）
const toastId = (toast: CornerToast) => {
  if (toast.kind === "next") return `next:${toast.bayId}`;
  if (toast.kind === "lateMerge") return `lateMerge:${toast.card.key}`;
  return `seniorOnly:${toast.cards.map((card) => card.key).join(",")}`;
};

// 右上に出す確かめと知らせ。盤面の操作を止めないので、続けてほかのものを出せば種類によらず 1 つの列に並べる。新しいものが先。
// 明示的な確認・取消、または元の操作の取り消しまで保持する。
export const useCornerToasts = (
  cards: readonly CaosCard[],
  practice: boolean,
) => {
  const [shown, setShown] = useState<
    (CornerToast & { id: string; ops: string[]; atMs: number })[]
  >([]);
  const previousMode = useRef(practice);
  useEffect(() => {
    if (previousMode.current === practice) return;
    previousMode.current = practice;
    setShown([]);
  }, [practice]);
  const valid = (notice: CornerToast) =>
    notice.kind !== "next" ||
    cards.some(
      (card) =>
        card.key === notice.card.key &&
        card.status === "brewing" &&
        card.dripper === notice.bayId,
    );
  const open: OpenCornerToast[] = shown
    .filter(valid)
    .map(({ atMs: _atMs, ...notice }) => notice);
  useEffect(() => {
    setShown((old) => {
      const next = old.filter(
        (notice) =>
          notice.kind !== "next" ||
          cards.some(
            (card) =>
              card.key === notice.card.key &&
              card.status === "brewing" &&
              card.dripper === notice.bayId,
          ),
      );
      return next.length === old.length ? old : next;
    });
  }, [cards]);
  useCaosStateLog("notice.active.changed", {
    notices: open.map(({ id, kind }) => ({ id, kind })),
  });
  const drop = (id: string) =>
    setShown((list) => list.filter((toast) => toast.id !== id));

  return {
    /** 出している確かめ・知らせ */
    open,
    /**
     * 確かめ・知らせを出す（同じものは置き換える。消えたものはここで捨てる）。ops は知らせのもとになった、端末に残した盤面の操作の id
     * （送った操作が断られて盤面が戻ったら、その知らせも消す。forgetOp。実データテストは端末に残さないので空）
     */
    show: (toast: CornerToast, ops: string[] = []) => {
      const id = toastId(toast);
      caosLog("notice.shown", { id, notice: toast, ops });
      const atMs = Date.now();
      setShown((list) => [
        { ...toast, id, ops, atMs },
        ...list.filter((t) => t.id !== id),
      ]);
    },
    /** 閉じて、出していたものを返す（もう消えていれば null。確かめを進めるとき） */
    take: (id: string) => {
      drop(id);
      return open.find((toast) => toast.id === id) ?? null;
    },
    /** 閉じる（確かめはやめる、知らせは読んだ） */
    dismiss: (id: string) => {
      caosLog("notice.dismissed", { id });
      drop(id);
    },
    /** 端末に残した盤面の操作（entry）が断られて盤面が戻ったので、その操作の知らせを消す（id で引くので、同じ名前のほかの操作の知らせは残す） */
    forgetOp: (entry: { id: string }) =>
      setShown((list) => list.filter((toast) => !toast.ops.includes(entry.id))),
    clear: () => setShown([]),
  };
};
