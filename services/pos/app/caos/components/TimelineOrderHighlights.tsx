import type { CaosCard } from "@cafeore/common";
import { type RefObject, useLayoutEffect, useState } from "react";
import { useOrderHighlights } from "../hooks/useOrderHighlights";
import { orderNoLabel } from "../logic/cards";
import { outsideHighlights } from "../logic/orderHighlights";

type Outside = ReturnType<typeof outsideHighlights>;
export type OutsideLane = Outside & { id: string; dripper: number | null };

/** 位置の監視は盤面に1つだけ置く。時刻計算・追従の処理は変えない。 */
export function useTimelineHighlightVisibility({
  containerRef,
  cards,
  stickyWidth,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  cards: readonly CaosCard[];
  stickyWidth: number;
}) {
  const highlight = useOrderHighlights();
  const orders = highlight?.orders;
  const [outside, setOutside] = useState<OutsideLane[]>([]);
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !orders) return;
    if (!orders.length) {
      setOutside((previous) => (previous.length ? [] : previous));
      return;
    }
    let frame = 0;
    const update = () => {
      const viewport = container.getBoundingClientRect();
      const byKey = new Map(cards.map((card) => [card.key, card]));
      const positioned = [
        ...container.querySelectorAll<HTMLElement>(
          "[data-timeline-highlight-card]",
        ),
      ].flatMap((element) => {
        const card = byKey.get(element.dataset.timelineHighlightCard ?? "");
        if (!card) return [];
        const { left, right } = element.getBoundingClientRect();
        return [{ card, left, right }];
      });
      const next = [...new Set(cards.map((card) => card.dripper))].flatMap(
        (dripper) =>
          orders.map((order) => ({
            id: order.id,
            dripper,
            ...outsideHighlights(
              positioned.filter((item) => item.card.dripper === dripper),
              order.id,
              {
                left: Math.max(0, viewport.left + stickyWidth),
                right: Math.min(window.innerWidth, viewport.right),
              },
            ),
          })),
      );
      setOutside((previous) =>
        JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
      );
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    update();
    container.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(container);
    return () => {
      container.removeEventListener("scroll", schedule);
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [containerRef, cards, orders, stickyWidth]);
  return outside;
}

/** 既存の目盛りの左端に収め、盤面・未割当欄の高さを変えない。 */
export function TimelineOrderHighlights({
  followingNow,
  onNow,
}: { followingNow: boolean; onNow: () => void }) {
  const highlight = useOrderHighlights();
  if (!highlight) return null;
  return (
    <div
      data-order-highlight-preserve
      className="flex h-full min-w-0 flex-1 items-center gap-1"
      aria-label="注文ハイライト"
    >
      {highlight.orders.map((order) => (
        <span
          key={order.id}
          className="font-black font-mono text-xs"
          style={{ color: order.color }}
        >
          #{orderNoLabel(order.no)}
        </span>
      ))}
      {!followingNow && (
        <button
          type="button"
          onClick={onNow}
          aria-label="現在に戻る"
          className="ml-auto h-[26px] shrink-0 rounded bg-red-500 px-1 font-bold text-[10px] text-white"
        >
          現在
        </button>
      )}
      <button
        type="button"
        aria-label="ハイライトを解除"
        onClick={highlight.clear}
        className="ml-auto h-[26px] shrink-0 rounded px-1 text-[10px] text-slate-600 hover:bg-slate-200"
      >
        解除
      </button>
    </div>
  );
}
