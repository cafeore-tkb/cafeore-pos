import type { CaosCard } from "@cafeore/common";

export const ORDER_HIGHLIGHT_COLORS = ["#F59E0B", "#EA580C"] as const;
export interface HighlightOrder {
  id: string;
  no: number;
  color: string;
}

/** 表示番号ではなく注文IDで追う。別注文への再帰的な強調はしない。 */
export const cardOrders = (card: CaosCard) =>
  [
    ...new Map(
      card.cups.map((cup) => [
        cup.orderId,
        { id: cup.orderId, no: cup.orderNo },
      ]),
    ).values(),
  ].sort((a, b) => a.no - b.no || a.id.localeCompare(b.id));

export function selectHighlights(
  orders: readonly { id: string; no: number }[],
  previous: readonly HighlightOrder[],
): HighlightOrder[] {
  const sorted = [
    ...new Map(orders.map((order) => [order.id, order])).values(),
  ].sort((a, b) => a.no - b.no || a.id.localeCompare(b.id));
  return sorted.map((order, index) => ({
    ...order,
    // 統合カードの番号を選び直しても、その番号の色は変えない。
    color:
      sorted.length === 1
        ? (previous.find((item) => item.id === order.id)?.color ??
          ORDER_HIGHLIGHT_COLORS[0])
        : ORDER_HIGHLIGHT_COLORS[index % ORDER_HIGHLIGHT_COLORS.length],
  }));
}

/** 番号検索など、既存の文字ラベルから移すときも曖昧な別日の同番号を選ばない。 */
export function labelOrders(
  cards: readonly CaosCard[],
  label: string,
  orderId?: string,
) {
  const numbers = new Set(
    label.split("+").map((no) => Number(no.replace(/^#/, ""))),
  );
  const candidates = [
    ...new Map(
      cards.flatMap(cardOrders).map((order) => [order.id, order]),
    ).values(),
  ];
  return candidates.filter(
    (order) =>
      numbers.has(order.no) &&
      (orderId
        ? order.id === orderId
        : candidates.filter((candidate) => candidate.no === order.no).length ===
          1),
  );
}

export function highlightParts(
  card: CaosCard,
  selection: readonly HighlightOrder[],
) {
  return cardOrders(card).map((order) => ({
    ...order,
    color: selection.find((item) => item.id === order.id)?.color ?? null,
  }));
}

export function highlightFrame(
  card: CaosCard,
  selection: readonly HighlightOrder[],
) {
  const parts = highlightParts(card, selection);
  if (!parts.some((part) => part.color)) return null;
  // 非対象の半分は透明にして、元のカードの枠を残す。
  const stops = parts.flatMap((part, index) => [
    `${part.color ?? "transparent"} ${(index / parts.length) * 100}%`,
    `${part.color ?? "transparent"} ${((index + 1) / parts.length) * 100}%`,
  ]);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export interface PositionedHighlightCard {
  card: CaosCard;
  left: number;
  right: number;
}

/** 一部でも見えているカードは画面内。杯数には選択した注文のカップだけを含む。 */
export function outsideHighlights(
  positioned: readonly PositionedHighlightCard[],
  orderId: string,
  viewport: { left: number; right: number },
) {
  const matching = positioned.filter(({ card }) =>
    card.cups.some((cup) => cup.orderId === orderId),
  );
  const group = (direction: "left" | "right") => {
    const hidden = matching.filter((item) =>
      direction === "left"
        ? item.right <= viewport.left
        : item.left >= viewport.right,
    );
    hidden.sort((a, b) =>
      direction === "left" ? b.right - a.right : a.left - b.left,
    );
    return {
      count: new Set(
        hidden.flatMap(({ card }) =>
          card.cups
            .filter((cup) => cup.orderId === orderId)
            .map((cup) => cup.id),
        ),
      ).size,
      key: hidden[0]?.card.key ?? null,
    };
  };
  return { left: group("left"), right: group("right") };
}
