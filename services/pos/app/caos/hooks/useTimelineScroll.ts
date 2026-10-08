import { useEffect, useLayoutEffect, useRef, useState } from "react";

// 管制盤 A のタイムラインの横スクロール。NOW を画面の左寄りの決まった位置に置き、時間とともにレーンの側を動かす。
// 見ている人がスクロール（か ±5分）で離れたら追うのをやめ、NOW の近くで止まるか「現在」で戻ったら、また追う。

export type TimelineCommand = {
  direction: "back" | "now" | "forward";
  id: number;
};

// Scroll positions this close to NOW count as following it.
const FOLLOW_TOLERANCE_PX = 24;
// Scrolled this far behind NOW, the board shows the past-history banner.
const PAST_VIEW_THRESHOLD_PX = 600;

export const useTimelineScroll = ({
  nowX,
  followLeftPx,
  originPx,
  pagePx,
  command,
}: {
  /** NOW の位置（px） */
  nowX: number;
  /** NOW を追うときのスクロールの位置（px） */
  followLeftPx: number;
  /** タイムラインの始まり（px）。時が変わって動いたら、見えているものを動かさないよう同じだけ戻す */
  originPx: number;
  /** ±5分 で動かす幅（px） */
  pagePx: number;
  command: TimelineCommand | null;
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFollowingNow, setIsFollowingNow] = useState(true);
  const [isScrolledToPast, setIsScrolledToPast] = useState(false);
  const followLeftRef = useRef(followLeftPx);
  followLeftRef.current = followLeftPx;

  // When the hour rolls over the track origin moves; shift the scroll by the same
  // amount before paint so whatever is on screen stays put.
  const previousOriginRef = useRef(originPx);
  useLayoutEffect(() => {
    const shiftPx = originPx - previousOriginRef.current;
    previousOriginRef.current = originPx;
    if (shiftPx && containerRef.current)
      containerRef.current.scrollLeft -= shiftPx;
  }, [originPx]);

  // Keep NOW at one fixed screen position; the timeline moves underneath it.
  useLayoutEffect(() => {
    if (!containerRef.current || !isFollowingNow) return;
    containerRef.current.scrollLeft = followLeftPx;
  }, [followLeftPx, isFollowingNow]);

  // Leave follow mode as soon as the view moves away, but resume only once scrolling
  // has settled near NOW so a scroll that merely passes NOW is not captured.
  const followSettleTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(followSettleTimerRef.current), []);
  // ±5分 starts a smooth scroll that begins slowly; don't mistake its first frames near NOW for a stop.
  const pagingUntilRef = useRef(0);
  const scheduleFollowCheck = (leftAtSchedule: number) => {
    followSettleTimerRef.current = window.setTimeout(() => {
      if (performance.now() < pagingUntilRef.current) {
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
    if (!containerRef.current) return;
    const currentLeft = containerRef.current.scrollLeft;
    // A boolean, so scrolling re-renders the board only when it crosses the threshold.
    setIsScrolledToPast(currentLeft < nowX - PAST_VIEW_THRESHOLD_PX);
    window.clearTimeout(followSettleTimerRef.current);
    if (Math.abs(currentLeft - followLeftPx) > FOLLOW_TOLERANCE_PX) {
      setIsFollowingNow(false);
      return;
    }
    scheduleFollowCheck(currentLeft);
  };

  // Run each header command once. ±5分 pages from the current view; 現在 returns to NOW,
  // and arriving there resumes following through onScroll.
  const handledCommandIdRef = useRef(command?.id);
  useEffect(() => {
    if (!command || command.id === handledCommandIdRef.current) return;
    handledCommandIdRef.current = command.id;
    const container = containerRef.current;
    if (!container) return;
    // Stop following first so the next clock tick does not cut the smooth scroll short.
    if (command.direction !== "now") {
      setIsFollowingNow(false);
      pagingUntilRef.current = performance.now() + 1000;
    }
    const left =
      command.direction === "now"
        ? followLeftRef.current
        : container.scrollLeft +
          (command.direction === "back" ? -pagePx : pagePx);
    container.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [command, pagePx]);

  return {
    containerRef,
    onScroll,
    /** 過去を見ている（「過去の抽出履歴を表示中」を出す） */
    isPastView: !isFollowingNow && isScrolledToPast,
  };
};
