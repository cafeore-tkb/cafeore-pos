import type React from "react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// スクロールバー（components/ScrollArea）の状態。つまみの長さと位置を枠（target）のスクロールに合わせ、
// つまみか溝を指・マウスで引くと枠をスクロールする（溝を押すと、つまみの真ん中がそこへ来る）。

export type ScrollAxis = "x" | "y";

export const AXES = {
  x: {
    position: "scrollLeft",
    view: "clientWidth",
    content: "scrollWidth",
    client: "clientX",
    start: "left",
    length: "width",
  },
  y: {
    position: "scrollTop",
    view: "clientHeight",
    content: "scrollHeight",
    client: "clientY",
    start: "top",
    length: "height",
  },
} as const;

/** つまみ。size は見えている割合（1 ならスクロールしない）、ratio はスクロールした割合 */
type Thumb = { size: number; ratio: number };

const readThumb = (element: HTMLElement, axis: ScrollAxis): Thumb => {
  const keys = AXES[axis];
  const range = element[keys.content] - element[keys.view];
  return {
    // 測る前（中身も枠も 0）は 1（スクロールしない）。NaN だと同じ値と見なせず測り直しが止まらない
    size:
      element[keys.content] > 0
        ? element[keys.view] / element[keys.content]
        : 1,
    ratio: range > 0 ? element[keys.position] / range : 0,
  };
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const useScrollBar = (
  target: React.RefObject<HTMLElement>,
  axis: ScrollAxis,
) => {
  const thumbRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<Thumb>({ size: 1, ratio: 0 });
  const dragTo = useRef<((event: React.PointerEvent) => void) | null>(null);

  const sync = useCallback(() => {
    if (!target.current) return;
    const next = readThumb(target.current, axis);
    setThumb((prev) =>
      prev.size === next.size && prev.ratio === next.ratio ? prev : next,
    );
  }, [target, axis]);
  // The content changes with the parent's renders, so measure after each one.
  useLayoutEffect(sync);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    element.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => {
      element.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [target, sync]);

  /** 溝の onPointerDown */
  const press = (event: React.PointerEvent<HTMLElement>) => {
    const element = target.current;
    if (!element || !thumbRef.current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const keys = AXES[axis];
    const track = event.currentTarget.getBoundingClientRect();
    const thumbRect = thumbRef.current.getBoundingClientRect();
    const thumbLength = thumbRect[keys.length];
    const travel = track[keys.length] - thumbLength;
    if (travel <= 0) return;
    const along = (pointer: React.PointerEvent) =>
      pointer[keys.client] - track[keys.start];
    // Grabbing the thumb keeps the finger where it took hold; pressing the track centres it there.
    const held = along(event) - (thumbRect[keys.start] - track[keys.start]);
    const grip = held >= 0 && held <= thumbLength ? held : thumbLength / 2;
    dragTo.current = (pointer) => {
      element[keys.position] =
        clamp01((along(pointer) - grip) / travel) *
        (element[keys.content] - element[keys.view]);
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    dragTo.current(event);
  };
  const release = () => {
    dragTo.current = null;
  };

  return {
    thumbRef,
    /** スクロールできる（つまみを出す） */
    scrollable: thumb.size < 1,
    thumb,
    handlers: {
      onPointerDown: press,
      onPointerMove: (event: React.PointerEvent) => dragTo.current?.(event),
      onPointerUp: release,
      onPointerCancel: release,
      onLostPointerCapture: release,
    },
  };
};
