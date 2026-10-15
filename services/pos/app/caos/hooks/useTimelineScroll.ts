import {
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cardSelector } from "../utils/scrollToCard";

// 管制盤 A のタイムラインの横スクロール。NOW を画面の左寄りの決まった位置に置き、時間とともにレーンの側を動かす（追従）。
// 手でスクロールしたら少しでも動いた時点で、±5分・カードへの操作なら押した時点で追従をやめる（NOW の線は本当の時刻の所を動く）。
// 「現在」で NOW の位置へ戻り、すぐ追従に戻る。手のスクロールが NOW の近くで止まったとき（タイムラインから指を離してから）も追従に戻る。

/** ヘッダーからの操作（±5分・現在）と、カード（cardKey。注文番号で探したカード）までスクロールする "card"。id で 1 回ずつ */
export type TimelineCommand = { id: number } & (
  | { direction: "back" | "now" | "forward" }
  | { direction: "card"; cardKey: string }
);

// 手のスクロールがこの近さ（px）で止まったら、NOW の位置へ寄せて追従に戻す
const FOLLOW_TOLERANCE_PX = 24;
// Scrolled this far behind NOW, the board shows the past-history banner.
const PAST_VIEW_THRESHOLD_PX = 600;
// 「現在」で NOW へ滑らかに戻るのを待つ長さの上限（ミリ秒）。戻っているあいだのスクロールは手のスクロールと見なさない
const RETURN_MAX_MS = 2000;

// ±5分・カードへの操作でスクロールする先（px）。カードがタイムラインに無ければ（表示する範囲より前に終わったなど）null
const commandLeft = (
  command: TimelineCommand,
  container: HTMLElement,
  { pagePx, cardInsetPx }: { pagePx: number; cardInsetPx: number },
) => {
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

// 「現在」で戻っている途中か（戻る先と期限。期限は performance.now() のミリ秒）
type Return = { left: number; until: number };
const isReturning = (current: Return | null) =>
  current !== null && performance.now() < current.until;

const TOUCH_ENDS = ["touchend", "touchcancel"] as const;

// タイムライン（スクロールの枠 ref と、スクロールバーを並べた外の枠）に指・マウスのボタンが触れているか。
// 触れているあいだは追従に戻さない（戻すと指の下で盤面が跳ぶ）。枠の中のなぞってもスクロールしない所（固定の列・掴めるカード）の指は数えない。
// ホイール・トラックパッドを回したら onWheel（「現在」の戻りを止めたので、そのスクロールを手のスクロールと見なす）
const usePressing = (ref: RefObject<HTMLElement>, onWheel: () => void) => {
  const pressing = useRef(false);
  const onWheelRef = useRef(onWheel);
  onWheelRef.current = onWheel;
  useEffect(() => {
    const frame = ref.current?.parentElement;
    if (!frame) return;
    const release = () => {
      pressing.current = false;
    };
    // タイムラインの外に残った指（iPad を持つ親指など）は数えない（Touch.target は触れ始めた要素のまま）
    const touchEnd = (event: TouchEvent) => {
      const inside = Array.from(event.touches).some(
        (touch) => touch.target instanceof Node && frame.contains(touch.target),
      );
      if (!inside) release();
    };
    const press = (event: Event) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      // 枠の中のなぞってもスクロールしない所（スクロールバーは枠の外なので数える）
      const still = target.closest(".touch-none");
      if (still && ref.current?.contains(still)) return;
      pressing.current = true;
      // 離す前に触れ始めた要素が作り直されると、離した知らせは window に届かないので、その要素でも受ける
      if (event.type === "touchstart")
        for (const type of TOUCH_ENDS)
          target.addEventListener(type, touchEnd as EventListener, {
            once: true,
          });
    };
    const wheel = () => onWheelRef.current();
    const options = { passive: true, capture: true };
    frame.addEventListener("touchstart", press, options);
    frame.addEventListener("mousedown", press, options);
    frame.addEventListener("wheel", wheel, options);
    for (const type of TOUCH_ENDS)
      window.addEventListener(type, touchEnd, options);
    window.addEventListener("mouseup", release, options);
    window.addEventListener("blur", release, options);
    return () => {
      frame.removeEventListener("touchstart", press, options);
      frame.removeEventListener("mousedown", press, options);
      frame.removeEventListener("wheel", wheel, options);
      for (const type of TOUCH_ENDS)
        window.removeEventListener(type, touchEnd, options);
      window.removeEventListener("mouseup", release, options);
      window.removeEventListener("blur", release, options);
    };
  }, [ref]);
  return () => pressing.current;
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
  // 「現在」で滑らかに戻っている先と期限。着いたら・ほかの操作で null
  const returnRef = useRef<Return | null>(null);
  const isPressing = usePressing(containerRef, () => {
    returnRef.current = null;
  });

  useEffect(() => {
    onFollowingChange?.(isFollowingNow);
  }, [isFollowingNow, onFollowingChange]);

  // この画面が自分で置いたスクロールの位置（そのスクロールの知らせは手のスクロールと見なさない）
  const ownLeftRef = useRef<number | null>(null);

  // When the hour rolls over the track origin moves; shift the scroll by the same
  // amount before paint so whatever is on screen stays put.
  // 「現在」で戻っている途中なら、戻りは止まるので、続く追従の effect がそのまま NOW に置く
  const previousOriginRef = useRef(originPx);
  useLayoutEffect(() => {
    const shiftPx = originPx - previousOriginRef.current;
    previousOriginRef.current = originPx;
    const container = containerRef.current;
    if (!shiftPx || !container) return;
    returnRef.current = null;
    ownLeftRef.current = placeScroll(container, container.scrollLeft - shiftPx);
  }, [originPx]);

  // Keep NOW at one fixed screen position; the timeline moves underneath it.
  // 「現在」で滑らかに戻っているあいだは、毎秒の位置で途中を切らない
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !isFollowingNow || isReturning(returnRef.current)) return;
    ownLeftRef.current = placeScroll(container, followLeftPx);
  }, [followLeftPx, isFollowingNow]);

  // 手のスクロールが NOW の近くで止まったら、追従に戻す（通り過ぎただけ・指を乗せたまま・±5分やカードへの途中では戻さない）
  const followSettleTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(followSettleTimerRef.current), []);
  // ±5分・カードへの操作は、ゆっくり始まる smooth scroll。始めの NOW の近くのコマを止まったと見なさない
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
    // 「現在」で戻っている途中（タイムラインを指で止めたら手のスクロール）。
    // 戻る先に着いたら、その時の NOW の位置に寄せて（倍速の実データテストでは戻るあいだにも NOW が進む）毎秒の追従に戻す
    if (isReturning(returnRef.current) && !isPressing()) {
      if (
        returnRef.current &&
        Math.abs(currentLeft - returnRef.current.left) < 2
      ) {
        returnRef.current = null;
        ownLeftRef.current = placeScroll(container, followLeftRef.current);
      }
      return;
    }
    returnRef.current = null;
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
    const left = followLeftRef.current;
    // もう NOW の位置なら、スクロールの知らせが来ないので待たない
    if (Math.abs(container.scrollLeft - left) < 1) return;
    returnRef.current = { left, until: performance.now() + RETURN_MAX_MS };
    container.scrollTo({ left, behavior: "smooth" });
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
    const left = commandLeft(command, container, { pagePx, cardInsetPx });
    if (left === null) return;
    // Stop following first so the next clock tick does not cut the smooth scroll short.
    returnRef.current = null;
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
