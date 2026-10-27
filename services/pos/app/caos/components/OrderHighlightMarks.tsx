import type { CaosCard } from "@cafeore/common";
import { useOrderHighlights } from "../hooks/useOrderHighlights";
import { orderNoLabel } from "../logic/cards";
import type { OutsideLane } from "./TimelineOrderHighlights";

/** 固定見出しに番号と画面外の方向を添える。杯数は選択した注文だけ。 */
export function OrderHighlightMarks({
  cards,
  outside,
}: { cards: readonly CaosCard[]; outside: readonly OutsideLane[] }) {
  const highlight = useOrderHighlights();
  const matching =
    highlight?.orders.filter((order) =>
      cards.some((card) => card.cups.some((cup) => cup.orderId === order.id)),
    ) ?? [];
  if (!matching.length) return null;
  return (
    <div
      className="flex flex-wrap gap-1"
      aria-label="このドリッパーにある選択注文"
    >
      {matching.map((order) => {
        const directions = outside.find(
          (item) => item.id === order.id && item.dripper === cards[0]?.dripper,
        );
        return (
          <span
            key={order.id}
            data-order-highlight-preserve
            className="inline-flex items-center gap-0.5 rounded bg-white font-bold font-mono text-[10px]"
            style={{ color: order.color }}
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: order.color }}
            />
            <span>#{orderNoLabel(order.no)}</span>
            {(["left", "right"] as const).map((direction) => {
              const target = directions?.[direction];
              return target?.count && target.key ? (
                <button
                  key={direction}
                  type="button"
                  onClick={() => highlight?.revealCard(target.key as string)}
                  aria-label={`注文 #${orderNoLabel(order.no)}の${direction === "left" ? "左" : "右"}にある${target.count}杯へ移動`}
                  className="min-h-5 rounded border border-current px-0.5 font-bold focus-visible:outline-2 focus-visible:outline-slate-900"
                >
                  {direction === "left"
                    ? `←${target.count}杯`
                    : `${target.count}杯→`}
                </button>
              ) : null;
            })}
          </span>
        );
      })}
    </div>
  );
}
