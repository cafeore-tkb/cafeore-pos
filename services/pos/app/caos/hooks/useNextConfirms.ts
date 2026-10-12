import type { CaosCard } from "@cafeore/common";
import { useState } from "react";

// 確かめを出しておく秒。何もしなければ消える（やめる扱い。何も送らない）
const NEXT_CONFIRM_SEC = 8;

/** 確かめている「次へ」（どのドリッパーの、どのカードを、始めてから何秒で終えようとしたか） */
export interface NextConfirm {
  bayId: number;
  card: CaosCard;
  elapsedSec: number;
}

/** 出している確かめ（何もしなければ消えるまでの残りの秒つき） */
export type OpenNextConfirm = NextConfirm & { secondsLeft: number };

// 押し間違いかもしれない「次へ」の確かめ。盤面の操作を止めないので、続けてほかのドリッパーでも押せば並べる
// （ドリッパーごとに 1 つ。同じドリッパーでもう一度押せば置き換える）。新しいものが先。
// nowMs は実時間の今（1 秒ごとに変わるので、残りの秒が数え下がる）。NEXT_CONFIRM_SEC 秒たったものは出さない。
export const useNextConfirms = (nowMs: number) => {
  const [asked, setAsked] = useState<(NextConfirm & { atMs: number })[]>([]);
  const open = asked.flatMap(({ atMs, ...confirm }): OpenNextConfirm[] => {
    const secondsLeft = Math.min(
      NEXT_CONFIRM_SEC,
      Math.ceil(NEXT_CONFIRM_SEC - (nowMs - atMs) / 1000),
    );
    return secondsLeft > 0 ? [{ ...confirm, secondsLeft }] : [];
  });
  const drop = (bayId: number) =>
    setAsked((list) => list.filter((confirm) => confirm.bayId !== bayId));

  return {
    /** 出している確かめ（残りの秒つき） */
    open,
    ask: (confirm: NextConfirm) =>
      setAsked((list) => [
        { ...confirm, atMs: Date.now() },
        ...list.filter((c) => c.bayId !== confirm.bayId),
      ]),
    /** ドリッパーの確かめを閉じ、出していたものを返す（もう消えていれば null） */
    take: (bayId: number) => {
      drop(bayId);
      return open.find((confirm) => confirm.bayId === bayId) ?? null;
    },
    /** ドリッパーの確かめを閉じる（やめる） */
    dismiss: drop,
    clear: () => setAsked([]),
  };
};
