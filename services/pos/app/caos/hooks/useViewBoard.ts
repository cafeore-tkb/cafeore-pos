import type { CaosCard, CaosCardStatus } from "@cafeore/common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { timelineArrivals } from "../logic/timeline";
import { soundManager } from "../utils/audio";
import { useDeviceSetting } from "./useDeviceSetting";
import { useLiveBoard } from "./useLiveBoard";

// 閲覧だけの画面（閲覧の画面・リベロビュー）の盤面。操作の画面と同じ cafeore-pos の盤面（useLiveBoard）を読むだけで、書き込みは送らない。
// タイムラインに新しく入ったカード（割り当てた・抽出を始めた。logic/timeline の timelineArrivals）を、通知音と点滅で知らせる。

/** 点滅させる長さ（caos.css の .caos-arrival と同じ） */
const FLASH_MS = 4000;

export const useViewBoard = (nowMs: number) => {
  const { cards, orders, status } = useLiveBoard({ enabled: true, nowMs });
  const sound = useViewSound();
  const flashKeys = useArrivals(cards, orders !== null, nowMs);
  return { cards, status, sound, flashKeys };
};

// 通知音。鳴らすかはヘッダーで切り替え、この端末に覚える。iPad は画面に触れた中でないと音を出せるようにならないので、
// 音ありのときは、画面のどこかに触れたら出せるようにする（それまではヘッダーに「触れると鳴る」と出す）。
const useViewSound = () => {
  const [on, setOn] = useDeviceSetting("caos-view-sound", false);
  const [ready, setReady] = useState(soundManager.ready);
  // 鳴らすか（soundManager.enabled）は、この画面を開いている間だけ切り替える（操作の画面の音の設定は変えない）
  useEffect(() => {
    const before = soundManager.enabled;
    soundManager.enabled = on;
    return () => {
      soundManager.enabled = before;
    };
  }, [on]);
  const unlock = useCallback(
    () => soundManager.unlock().then(() => setReady(soundManager.ready)),
    [],
  );
  useEffect(() => {
    if (!on || ready) return;
    window.addEventListener("pointerup", unlock);
    return () => window.removeEventListener("pointerup", unlock);
  }, [on, ready, unlock]);

  return {
    on,
    /** 音を出せる（音ありで、画面に触れたあと） */
    ready,
    /** 音あり・なしを切り替える。音ありにしたら確かめに 1 回鳴らす。音ありでまだ出せないときは、出せるようにするだけ */
    toggle: () => {
      if (on && !ready) {
        void unlock();
        return;
      }
      soundManager.enabled = !on;
      if (!on) {
        void unlock();
        soundManager.playComplete();
      }
      setOn(!on);
    },
  };
};

export type ViewSound = ReturnType<typeof useViewSound>;

// 新しく入ったカードを知らせる。入ったら通知音を鳴らし（鳴らすかは useViewSound が決める soundManager.enabled）、
// そのカードの key を数秒だけ返す（点滅させる）。開いたときに盤面にあったカードは知らせない（ready は注文が届いたか。届くまでは比べない）。
// 点滅している間に同じカードがまた入ったとき（同じ端末の操作の画面のタブが送った操作を、こちらの注文が届く前に外して戻ったときなど）は知らせ直さない。
const useArrivals = (
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
