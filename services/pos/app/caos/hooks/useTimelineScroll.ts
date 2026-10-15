import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cardSelector } from "../utils/scrollToCard";

// 管制盤 A のタイムラインの横スクロール。NOW を画面の左寄りの決まった位置に置き、時間とともにレーンの側を動かす（追従）。
// 見ている人が手でスクロール（か ±5分・カードへ）したら、少しでも追従をやめる（NOW の線はそのまま本当の時刻の所を動く）。
// 「現在」で NOW の位置へ戻り、すぐ追従に戻る。手のスクロールが NOW の近くで止まったとき（指を離してから）も追従に戻る。

/** ヘッダーからの操作（±5分・現在）と、カード（cardKey。注文番号で探したカード）までスクロールする "card"。id で 1 回ずつ */
export type TimelineCommand = { id: number } & (
  | { direction: "back" | "now" | "forward" }
  | { direction: "card"; cardKey: string }
);

// Scroll positions this close to NOW count as following it.
const FOLLOW_TOLERANCE_PX = 24;
// Scrolled this far behind NOW, the board shows the past-history banner.
const PAST_VIEW_THRESHOLD_PX = 600;
// 「現在」で NOW へ滑らかに戻るのを待つ長さの上限（ミリ秒）。戻っているあいだのスクロールは手のスクロールと見なさない
const RETURN_MAX_MS = 2000;

// 操作でスクロールする先（px）。カードがタイムラインに無ければ（表示する範囲より前に終わったなど）null
const commandLeft = (
  command: TimelineCommand,
  container: HTMLElement,
  {
    followLeftPx,
    pagePx,
    cardInsetPx,
  }: { followLeftPx: number; pagePx: number; cardInsetPx: number },
) => {
  if (command.direction === "now") return followLeftPx;
  if (command.direction === "card") {
    const card = container.querySelector(cardSelector(command.cardKey));
    if (!card) return null;
    return (
      container.scrollLeft +
      card.getBoundingClientRect().left -
      container.getBoundingClientRect().left -
      cardInsetPx
    );
  }
  return (
    container.scrollLeft + (command.direction === "back" ? -pagePx : pagePx)
  );
};

// スクロールの位置を枠の CSS の変数 --timeline-left（px）に書く（カードが左の固定の列に隠れた分を、描き直さずに受ける）
const writeScrollVar = (container: HTMLElement) =>
  container.style.setProperty("--timeline-left", `${container.scrollLeft}px`);

// 枠のスクロールを left に置き、置いた位置（ブラウザが丸めた値）を返す
const placeScroll = (container: HTMLElement, left: number) => {
  container.scrollLeft = left;
  writeScrollVar(container);
  return container.scrollLeft;
};

// 画面に指・マウスのボタンが触れているか（触れているあいだは追従に戻さない。戻すと指の下で盤面が跳ぶ）
const PRESS_EVENTS = [
  "touchstart",
  "touchend",
  "touchcancel",
  "mousedown",
  "mouseup",
] as const;
const usePressing = () => {
  const pressing = useRef({ touches: 0, mouse: false });
  useEffect(() => {
    const onPress = (event: TouchEvent | MouseEvent) => {
      if ("touches" in event) pressing.current.touches = event.touches.length;
      else pressing.current.mouse = event.buttons !== 0;
    };
    const options = { passive: true, capture: true };
    for (const type of PRESS_EVENTS)
      window.addEventListener(type, onPress, options);
    return () => {
      for (const type of PRESS_EVENTS)
        window.removeEventListener(type, onPress, options);
    };
  }, []);
  return () => pressing.current.touches > 0 || pressing.current.mouse;
};

export const useTimelineScroll = ({
  nowX,
  followLeftPx,
  originPx,
  pagePx,
  cardInsetPx,
  command,
  onFollowingChange,
}: {
  /** NOW の位置（px） */
  nowX: number;
  /** NOW を追うときのスクロールの位置（px） */
  followLeftPx: number;
  /** タイムラインの始まり（px）。時が変わって動いたら、見えているものを動かさないよう同じだけ戻す */
  originPx: number;
  /** ±5分 で動かす幅（px） */
  pagePx: number;
  /** カードまでスクロールするとき、カードの左を見えている所の左端からどれだけ空けるか（px。左端に固定した列の幅も入れる） */
  cardInsetPx: number;
  command: TimelineCommand | null;
  /** 追従しているかが変わったとき（ヘッダーの「現在」の見た目） */
  onFollowingChange?: (following: boolean) => void;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFollowingNow, setIsFollowingNow] = useState(true);
  const [isScrolledToPast, setIsScrolledToPast] = useState(false);
  const followLeftRef = useRef(followLeftPx);
  useLayoutEffect(() => {
    followLeftRef.current = followLeftPx;
  }, [followLeftPx]);
  const isPressing = usePressing();

  const onFollowingChangeRef = useRef(onFollowingChange);
  onFollowingChangeRef.current = onFollowingChange;
  useEffect(() => {
    onFollowingChangeRef.current?.(isFollowingNow);
  }, [isFollowingNow]);

  // この画面が自分で置いたスクロールの位置（そのスクロールの知らせは手のスクロールと見なさない）
  const ownLeftRef = useRef<number | null>(null);
  // 「現在」で滑らかに戻っている間（performance.now() のミリ秒まで。NOW の位置に着いたら 0）
  const returningUntilRef = useRef(0);

  // When the hour rolls over the track origin moves; shift the scroll by the same
  // amount before paint so whatever is on screen stays put.
  const previousOriginRef = useRef(originPx);
  useLayoutEffect(() => {
    const shiftPx = originPx - previousOriginRef.current;
    previousOriginRef.current = originPx;
    const container = containerRef.current;
    if (shiftPx && container)
      ownLeftRef.current = placeScroll(
        container,
        container.scrollLeft - shiftPx,
      );
  }, [originPx]);

  // Keep NOW at one fixed screen position; the timeline moves underneath it.
  // 「現在」で滑らかに戻っているあいだは、毎秒の位置で途中を切らない
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !isFollowingNow) return;
    if (performance.now() < returningUntilRef.current) return;
    ownLeftRef.current = placeScroll(container, followLeftPx);
  }, [followLeftPx, isFollowingNow]);

  // 手のスクロールが NOW の近くで止まったら、追従に戻す（通り過ぎただけ・指を乗せたまま・±5分の途中では戻さない）
  const followSettleTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(followSettleTimerRef.current), []);
  // ±5分 starts a smooth scroll that begins slowly; don't mistake its first frames near NOW for a stop.
  const pagingUntilRef = useRef(0);
  const scheduleFollowCheck = (leftAtSchedule: number) => {
    window.clearTimeout(followSettleTimerRef.current);
    followSettleTimerRef.current = window.setTimeout(() => {
      if (performance.now() < pagingUntilRef.current || isPressing()) {
        scheduleFollowCheck(leftAtSchedule);
        return;
      }
      const settledLeft = containerRef.current?.scrollLeft;
      if (
        settledLeft !== undefined &&
        Math.abs(settledLeft - leftAtSchedule) < 1 &&
        Math.abs(settledLeft - followLeftRef.current) <= FOLLOW_TOLERANCE_PX
      ) {
        setIsFollowingNow(true);
      }
    }, 150);
  };
  // While browsing, NOW keeps moving away from a still view; re-check the banner each tick.
  useEffect(() => {
    if (isFollowingNow || !containerRef.current) return;
    setIsScrolledToPast(
      containerRef.current.scrollLeft < nowX - PAST_VIEW_THRESHOLD_PX,
    );
  }, [nowX, isFollowingNow]);

  const onScroll = () => {
    const container = containerRef.current;
    if (!container) return;
    writeScrollVar(container);
    const currentLeft = container.scrollLeft;
    // A boolean, so scrolling re-renders the board only when it crosses the threshold.
    setIsScrolledToPast(currentLeft < nowX - PAST_VIEW_THRESHOLD_PX);
    // 「現在」で戻っている途中（指で止めたら手のスクロール）。NOW の位置に着いたら、また毎秒の位置で追う
    if (performance.now() < returningUntilRef.current && !isPressing()) {
      if (Math.abs(currentLeft - followLeftRef.current) < 2) {
        returningUntilRef.current = 0;
        ownLeftRef.current = currentLeft;
      }
      return;
    }
    returningUntilRef.current = 0;
    // 自分で置いた位置は、手のスクロールではない
    if (
      ownLeftRef.current !== null &&
      Math.abs(currentLeft - ownLeftRef.current) < 1
    )
      return;
    ownLeftRef.current = null;
    setIsFollowingNow(false);
    if (Math.abs(currentLeft - followLeftRef.current) <= FOLLOW_TOLERANCE_PX)
      scheduleFollowCheck(currentLeft);
    else window.clearTimeout(followSettleTimerRef.current);
  };

  // 「現在」：NOW の位置へ滑らかに戻し、すぐ追従する（戻り終えたら毎秒の位置で NOW を決まった所に置く）
  const toNow = () => {
    const container = containerRef.current;
    if (!container) return;
    window.clearTimeout(followSettleTimerRef.current);
    setIsFollowingNow(true);
    // もう NOW の位置なら、スクロールの知らせが来ないので待たない
    if (Math.abs(container.scrollLeft - followLeftRef.current) < 1) return;
    returningUntilRef.current = performance.now() + RETURN_MAX_MS;
    container.scrollTo({ left: followLeftRef.current, behavior: "smooth" });
  };

  // Run each header command once. ±5分 pages from the current view; 現在 returns to NOW and follows it.
  // "card" brings that card to the left of the view.
  const handledCommandIdRef = useRef(command?.id);
  // biome-ignore lint/correctness/useExhaustiveDependencies: toNow reads refs only
  useEffect(() => {
    if (!command || command.id === handledCommandIdRef.current) return;
    handledCommandIdRef.current = command.id;
    if (command.direction === "now") {
      toNow();
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    const left = commandLeft(command, container, {
      followLeftPx: followLeftRef.current,
      pagePx,
      cardInsetPx,
    });
    if (left === null) return;
    // Stop following first so the next clock tick does not cut the smooth scroll short.
    setIsFollowingNow(false);
    pagingUntilRef.current = performance.now() + 1000;
    container.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [command, pagePx, cardInsetPx]);

  return {
    containerRef,
    onScroll,
    /** NOW を決まった位置に置いて追っている */
    isFollowingNow,
    /** 「現在」と同じ（NOW へ戻って追う） */
    toNow,
    /** 過去を見ている（「過去の抽出履歴を表示中」を出す） */
    isPastView: !isFollowingNow && isScrolledToPast,
  };
};
