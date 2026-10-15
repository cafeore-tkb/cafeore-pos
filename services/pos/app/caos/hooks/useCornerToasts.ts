import type { CaosCard, CaosLane } from "@cafeore/common";
import { useState } from "react";

// 右上に出しておく秒。何もしなければ消える（確かめはやめる扱いで何も送らず、知らせは読んだ扱い）
const SHOW_SEC = 8;

/**
 * 右上に出す確かめと知らせ（盤面の操作を止めない）
 *   - next（確かめ）：押し間違いかもしれない「次へ」（どのドリッパーの、どのカードを、始めてから何秒で終えようとしたか）。［やめる］［次へ進める］
 *   - lateMerge（知らせ）：抽出を始めてから時間のたったカードへ統合した（card を into へ統合した。into は始めてから何秒か）。統合はもうしてあり、［閉じる］だけ
 *   - seniorOnly（知らせ）：上級生のみのカード（cards。まとめて移したときは何枚も）を、上級生でない担当者（lane）のドリッパーに置いた。［閉じる］だけ
 */
export type CornerToast =
  | { kind: "next"; bayId: number; card: CaosCard; elapsedSec: number }
  | { kind: "lateMerge"; card: CaosCard; into: CaosCard; elapsedSec: number }
  | { kind: "seniorOnly"; cards: CaosCard[]; lane: CaosLane };

/** 出している確かめ・知らせ（id と、何もしなければ消えるまでの残りの秒つき。ops は知らせのもとになった、端末に残した盤面の操作の id） */
export type OpenCornerToast = CornerToast & {
  id: string;
  ops: string[];
  secondsLeft: number;
};

// 同じものは 1 つ（同じドリッパーの「次へ」・同じカードの統合・同じカードを置いたのをもう一度すれば置き換える）
const toastId = (toast: CornerToast) => {
  if (toast.kind === "next") return `next:${toast.bayId}`;
  if (toast.kind === "lateMerge") return `lateMerge:${toast.card.key}`;
  return `seniorOnly:${toast.cards.map((card) => card.key).join(",")}`;
};

// 右上に出す確かめと知らせ。盤面の操作を止めないので、続けてほかのものを出せば種類によらず 1 つの列に並べる。新しいものが先。
// nowMs は実時間の今（1 秒ごとに変わるので、残りの秒が数え下がる）。SHOW_SEC 秒たったものは出さない。
export const useCornerToasts = (nowMs: number) => {
  const [shown, setShown] = useState<
    (CornerToast & { id: string; ops: string[]; atMs: number })[]
  >([]);
  const open = shown.flatMap(({ atMs, ...toast }): OpenCornerToast[] => {
    const secondsLeft = Math.min(
      SHOW_SEC,
      Math.ceil(SHOW_SEC - (nowMs - atMs) / 1000),
    );
    return secondsLeft > 0 ? [{ ...toast, secondsLeft }] : [];
  });
  const drop = (id: string) =>
    setShown((list) => list.filter((toast) => toast.id !== id));

  return {
    /** 出している確かめ・知らせ（残りの秒つき） */
    open,
    /**
     * 確かめ・知らせを出す（同じものは置き換える。消えたものはここで捨てる）。ops は知らせのもとになった、端末に残した盤面の操作の id
     * （送った操作が断られて盤面が戻ったら、その知らせも消す。forgetOp。実データテストは端末に残さないので空）
     */
    show: (toast: CornerToast, ops: string[] = []) => {
      const id = toastId(toast);
      const atMs = Date.now();
      setShown((list) => [
        { ...toast, id, ops, atMs },
        ...list.filter((t) => t.id !== id && atMs - t.atMs < SHOW_SEC * 1000),
      ]);
    },
    /** 閉じて、出していたものを返す（もう消えていれば null。確かめを進めるとき） */
    take: (id: string) => {
      drop(id);
      return open.find((toast) => toast.id === id) ?? null;
    },
    /** 閉じる（確かめはやめる、知らせは読んだ） */
    dismiss: drop,
    /** 端末に残した盤面の操作（entry）が断られて盤面が戻ったので、その操作の知らせを消す（id で引くので、同じ名前のほかの操作の知らせは残す） */
    forgetOp: (entry: { id: string }) =>
      setShown((list) => list.filter((toast) => !toast.ops.includes(entry.id))),
    clear: () => setShown([]),
  };
};
