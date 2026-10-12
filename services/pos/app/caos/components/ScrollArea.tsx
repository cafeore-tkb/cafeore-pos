import type React from "react";
import { useRef } from "react";
import { AXES, type ScrollAxis, useScrollBar } from "../hooks/useScrollBar";

// カードを並べたスクロールの枠。カードの上をなぞると掴むので、スクロールは指で掴める太いスクロールバー（いつも出す）で行う。
// カードの無い所をなぞるスクロールと、マウスのホイール・トラックパッドのスクロールはふつうの枠と同じに効く。OS の細いバーは隠す。

// つまみの長さの下限（指で掴める長さ）
const MIN_THUMB_PX = 48;

const LAYOUT = {
  x: {
    frame: "flex-col",
    scroller: "overflow-x-auto overflow-y-hidden",
    track: "h-5 w-full border-t",
    thumb: "inset-y-1",
  },
  y: {
    frame: "flex-row",
    scroller: "overflow-y-auto",
    track: "h-full w-5 border-l",
    thumb: "inset-x-1",
  },
} as const;

export const ScrollArea: React.FC<{
  axis: ScrollAxis;
  /** 横バーを直前のヘッダー行へ重ねる（管制盤 A の未割当だけ） */
  trackPlacement?: "end" | "header";
  /** スクロールする枠（渡さなければ中で持つ） */
  scrollRef?: React.RefObject<HTMLDivElement>;
  onScroll?: () => void;
  /** 外の枠（スクロールする枠とバーを並べる） */
  className?: string;
  /** スクロールする枠 */
  scrollerClassName?: string;
  children: React.ReactNode;
}> = ({
  axis,
  trackPlacement = "end",
  scrollRef,
  onScroll,
  className = "",
  scrollerClassName = "",
  children,
}) => {
  const ownRef = useRef<HTMLDivElement>(null);
  const ref = scrollRef ?? ownRef;
  const bar = useScrollBar(ref, axis);
  const layout = LAYOUT[axis];
  const trackClassName =
    axis === "x" && trackPlacement === "header"
      ? "absolute -top-[30px] right-[220px] left-[230px] h-5 rounded-md border"
      : `relative ${layout.track}`;
  const length = `max(${MIN_THUMB_PX}px, ${bar.thumb.size * 100}%)`;
  return (
    <div className={`flex min-h-0 min-w-0 ${layout.frame} ${className}`}>
      <div
        ref={ref}
        onScroll={onScroll}
        className={`min-h-0 min-w-0 flex-1 ${layout.scroller} [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${scrollerClassName}`}
      >
        {children}
      </div>
      <div
        {...bar.handlers}
        aria-hidden="true"
        className={`group border-(color:--caos-scrollbar-line) bg-(color:--caos-scrollbar-track) shrink-0 touch-none ${trackClassName}`}
      >
        {bar.scrollable && (
          <div
            ref={bar.thumbRef}
            className={`bg-(color:--caos-scrollbar-thumb) group-active:bg-(color:--caos-scrollbar-thumb-active) absolute rounded-full ${layout.thumb}`}
            style={{
              [AXES[axis].length]: length,
              [AXES[axis].start]:
                `calc((100% - ${length}) * ${bar.thumb.ratio})`,
            }}
          />
        )}
      </div>
    </div>
  );
};
