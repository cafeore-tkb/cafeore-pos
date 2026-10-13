import type { CaosCard, CaosCardStatus } from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
import { timelineArrivals } from "../logic/timeline";
import { soundManager } from "../utils/audio";

// 閲覧だけの画面で、タイムラインに新しく入ったカード（割り当てた・抽出を始めた。logic/timeline の timelineArrivals）を知らせる。
// 入ったら通知音を鳴らし（鳴らすかは soundManager.enabled。useViewSound で切り替える）、そのカードの key を数秒だけ返す（点滅させる）。
// 開いたときに盤面にあったカードは知らせない（ready は注文が届いたか。届くまでは比べない）。
// 点滅している間に同じカードがまた入ったとき（同じ端末の操作の画面のタブが送った操作を、こちらの注文が届く前に外して戻ったときなど）は知らせ直さない。

/** 点滅させる長さ（caos.css の .caos-arrival と同じ） */
const FLASH_MS = 4000;

export const useTimelineArrivals = (
  cards: readonly CaosCard[],
  ready: boolean,
  nowMs: number,
) => {
  const seen = useRef<ReadonlyMap<string, CaosCardStatus> | null>(null);
  // 点滅させるカードの key と、止める時刻
  const [flashUntil, setFlashUntil] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const latestFlash = useRef(flashUntil);
  latestFlash.current = flashUntil;
  useEffect(() => {
    if (!ready) return;
    const previous = seen.current;
    seen.current = new Map(cards.map((card) => [card.key, card.status]));
    if (!previous) return;
    const now = Date.now();
    const arrived = timelineArrivals(previous, cards).filter(
      (key) => (latestFlash.current.get(key) ?? 0) <= now,
    );
    if (arrived.length === 0) return;
    soundManager.playComplete();
    setFlashUntil(
      new Map([
        ...[...latestFlash.current].filter(([, until]) => until > now),
        ...arrived.map((key) => [key, now + FLASH_MS] as const),
      ]),
    );
  }, [cards, ready]);

  return useMemo(
    () =>
      new Set(
        [...flashUntil]
          .filter(([, until]) => until > nowMs)
          .map(([key]) => key),
      ),
    [flashUntil, nowMs],
  );
};
