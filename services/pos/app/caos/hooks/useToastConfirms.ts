import type { CaosCard, CaosLane } from "@cafeore/common";
import { useState } from "react";

// 確かめを出しておく秒。何もしなければ消える（やめる扱い。何も送らない）
const CONFIRM_SEC = 8;

/**
/**
 * 抽出中のカードを終えたあとに始めるもの。head は待機の先頭（「次へ」）、none は何も始めない（抽出中のカードを押した）、
 * key はそのカード（押した待機のカード）
 */
export type NextStart = "head" | "none" | { key: string };

/**
 * 右上に出す確かめと知らせ（盤面の操作を止めない）
 *   - next：押し間違いかもしれない、抽出中のカードを終える操作の確かめ（どのドリッパーの、どのカードを、始めてから何秒で終えようとしたか。
 *     start は終えたあとに始めるもの）
 *   - lateMerge：抽出を始めてから時間のたったカードへ統合した知らせ（card を into へ統合した。into は始めてから何秒か）。
 *     統合はもうしてあり、押すものは「閉じる」だけ
 *   - seniorOnly：上級生のみのカード（card）を、上級生でない担当者（lane。担当者なしも）のドリッパーに置いた知らせ。押すものは「閉じる」だけ
 */
export type ToastConfirm =
  | {
      kind: "next";
      bayId: number;
      card: CaosCard;
      elapsedSec: number;
      start: NextStart;
    }
  | { kind: "lateMerge"; card: CaosCard; into: CaosCard; elapsedSec: number }
  | { kind: "seniorOnly"; card: CaosCard; lane: CaosLane };

/** 出している確かめ（id と、何もしなければ消えるまでの残りの秒つき） */
export type OpenToastConfirm = ToastConfirm & {
  id: string;
  secondsLeft: number;
};

// 同じものの確かめ・知らせは 1 つ（同じドリッパーの「次へ」・同じカードの統合をもう一度すれば置き換える）
const confirmId = (confirm: ToastConfirm) => {
  if (confirm.kind === "next") return `next:${confirm.bayId}`;
  return `${confirm.kind}:${confirm.card.key}`;
};

// 右上に出す確かめと知らせ。盤面の操作を止めないので、続けてほかのものを出せば種類によらず 1 つの列に並べる。新しいものが先。
// nowMs は実時間の今（1 秒ごとに変わるので、残りの秒が数え下がる）。CONFIRM_SEC 秒たったものは出さない。
export const useToastConfirms = (nowMs: number) => {
  const [asked, setAsked] = useState<
    (ToastConfirm & { id: string; atMs: number })[]
  >([]);
  const open = asked.flatMap(({ atMs, ...confirm }): OpenToastConfirm[] => {
    const secondsLeft = Math.min(
      CONFIRM_SEC,
      Math.ceil(CONFIRM_SEC - (nowMs - atMs) / 1000),
    );
    return secondsLeft > 0 ? [{ ...confirm, secondsLeft }] : [];
  });
  const drop = (id: string) =>
    setAsked((list) => list.filter((confirm) => confirm.id !== id));

  return {
    /** 出している確かめ（残りの秒つき） */
    open,
    /** 確かめを出す（同じものは置き換える。消えたものはここで捨てる） */
    ask: (confirm: ToastConfirm) => {
      const id = confirmId(confirm);
      const atMs = Date.now();
      setAsked((list) => [
        { ...confirm, id, atMs },
        ...list.filter(
          (c) => c.id !== id && atMs - c.atMs < CONFIRM_SEC * 1000,
        ),
      ]);
    },
    /** 確かめを閉じ、出していたものを返す（もう消えていれば null） */
    take: (id: string) => {
      drop(id);
      return open.find((confirm) => confirm.id === id) ?? null;
    },
    /** 確かめを閉じる（やめる） */
    dismiss: drop,
    clear: () => setAsked([]),
  };
};
