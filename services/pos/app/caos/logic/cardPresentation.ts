import { type CaosCard, dripperLabel } from "@cafeore/common";

/** 同一注文でも、通常の抽出と淹れ直しの番号は別々に表示する。強調は共通の注文IDを使う。 */
export const cardNumberParts = (card: CaosCard) =>
  [
    ...new Map(
      card.cups.map((cup) => [
        `${cup.orderId}:${cup.emergency}`,
        { id: cup.orderId, no: cup.orderNo, emergency: cup.emergency },
      ]),
    ).values(),
  ].sort(
    (a, b) =>
      a.no - b.no ||
      a.id.localeCompare(b.id) ||
      Number(b.emergency) - Number(a.emergency),
  );

/** 同じ注文の2杯や淹れ直しは、複数注文を統合したカードとは区別する。 */
export const isMergedOrderCard = (card: CaosCard) =>
  new Set(card.cups.map((cup) => cup.orderId)).size > 1;

/** 自由記述より、割当先が分かるレーンの番号を優先する。 */
export function cardNomination(card: CaosCard) {
  const lanes = [
    ...new Set(card.cups.flatMap((cup) => cup.nominatedDripper ?? [])),
  ].sort((a, b) => a - b);
  return {
    lane: lanes.map(dripperLabel).join("・"),
    text: [
      ...new Set(
        card.cups
          .filter((cup) => cup.nominatedDripper === null)
          .flatMap((cup) => cup.nominee || []),
      ),
    ].join("・"),
  };
}

export interface CardLabelWidth {
  key: string;
  width: number;
  compactWidth?: number;
  priority: number;
}

/** 指名レーンと提供済みの状態を確保し、補助札は残りの幅で省略する。 */
export function fittingCardLabels(
  available: number,
  product: number,
  labels: readonly CardLabelWidth[],
  gap: number,
) {
  const required = (label: CardLabelWidth) =>
    label.key === "lane" || label.key === "served";
  const requiredWidth = labels
    .filter(required)
    .reduce((sum, label) => sum + (label.compactWidth ?? label.width) + gap, 0);
  const wrapRequired = requiredWidth > available;
  const productWidth = Math.max(
    0,
    Math.min(product, available - requiredWidth),
  );
  const visible = new Set<string>();
  const compact = new Set<string>();
  const fullWidth =
    productWidth + labels.reduce((sum, label) => sum + gap + label.width, 0);
  if (fullWidth <= available)
    return {
      visible: new Set(labels.map((label) => label.key)),
      compact,
      productWidth,
      wrapRequired,
    };
  let used = productWidth;
  const sorted = [...labels].sort(
    (a, b) =>
      Number(required(b)) - Number(required(a)) || a.priority - b.priority,
  );
  for (const label of sorted) {
    const width = label.compactWidth ?? label.width;
    if (required(label) || used + gap + width <= available) {
      visible.add(label.key);
      if (label.compactWidth !== undefined) compact.add(label.key);
      used += gap + width;
    }
  }
  // ★だけでも条件は残る。余裕が戻ったら説明の文字も戻す。
  for (const label of sorted) {
    if (
      compact.has(label.key) &&
      used + label.width - (label.compactWidth ?? label.width) <= available
    ) {
      used += label.width - (label.compactWidth ?? label.width);
      compact.delete(label.key);
    }
  }
  return { visible, compact, productWidth, wrapRequired };
}
