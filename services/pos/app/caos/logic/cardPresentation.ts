import { type CaosCard, dripperLabel } from "@cafeore/common";

/** 同一注文でも、通常の抽出と入れ直しの番号は別々に表示する。強調は共通の注文IDを使う。 */
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

/** レーン名・上級生アイコンを先に残し、接頭語・補助札は幅に合わせて省略する。 */
export function fittingCardLabels(
  available: number,
  product: number,
  labels: readonly CardLabelWidth[],
  gap: number,
) {
  const lane = labels.find((label) => label.key === "lane");
  const productWidth = Math.max(
    0,
    Math.min(
      product,
      available - (lane ? (lane.compactWidth ?? lane.width) + gap : 0),
    ),
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
    };
  let used = productWidth;
  const sorted = [...labels].sort((a, b) => a.priority - b.priority);
  for (const label of sorted) {
    const width = label.compactWidth ?? label.width;
    if (label.key === "lane" || used + gap + width <= available) {
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
  return { visible, compact, productWidth };
}
