import { type CaosCard, readableTextColor } from "@cafeore/common";
import { cardOrderNos } from "./cards";
import type { LiberoLane } from "./libero";

/** 全カップを数える。混在カードを先頭カップだけで代表させない。 */
export const liberoCupCounts = (card: CaosCard) => {
  const iced = card.cups.filter((cup) => cup.item.item_type.iced_brew).length;
  return { hot: card.cups.length - iced, iced };
};

const tint = (end: number[], amount: number) =>
  `#${end
    .map((channel) =>
      Math.round(255 + (channel - 255) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/** 混在時は赤・青を杯数の比率で分割し、両方を残す。 */
export const liberoColor = (card: CaosCard, intensity: number) => {
  const amount = Math.max(0, Math.min(1, intensity));
  const hotColor = tint([185, 28, 28], amount);
  const icedColor = tint([29, 78, 216], amount);
  const { hot, iced } = liberoCupCounts(card);
  const backgroundColor = hot ? hotColor : icedColor;
  return {
    backgroundColor,
    backgroundImage:
      hot && iced
        ? `linear-gradient(to right, ${hotColor} 0% ${(hot / card.cups.length) * 100}%, ${icedColor} ${(hot / card.cups.length) * 100}% 100%)`
        : undefined,
    color: readableTextColor(backgroundColor),
  };
};

/** 終了間際に濃さが加速する、0〜1に正規化した指数曲線。 */
export const brewIntensity = (progress: number) =>
  Math.expm1(2.5 * Math.max(0, Math.min(1, progress))) / Math.expm1(2.5);

/** 待機先頭を注文でまとめ、若い番号のグループから濃→薄を等間隔にする。
 * 統合注文を介して番号が重なるカードも同じグループにする。実際のキューは動かさない。
 */
export const nextIntensities = (rows: readonly LiberoLane[]) => {
  const groups: { numbers: Set<number>; keys: string[] }[] = [];
  for (const row of rows) {
    const card = row.lane.queued[0];
    if (!card) continue;
    const numbers = new Set(cardOrderNos(card));
    const keys = [card.key];
    for (let i = groups.length - 1; i >= 0; i--) {
      if (![...groups[i].numbers].some((no) => numbers.has(no))) continue;
      for (const no of groups[i].numbers) numbers.add(no);
      keys.push(...groups[i].keys);
      groups.splice(i, 1);
    }
    groups.push({ numbers, keys });
  }
  groups.sort((a, b) => Math.min(...a.numbers) - Math.min(...b.numbers));
  return new Map(
    groups.flatMap((group, index) => {
      // 最優先は最濃、最後も赤／青を判別できる薄さにする。
      const intensity =
        groups.length === 1 ? 1 : 1 - (0.75 * index) / (groups.length - 1);
      return group.keys.map((key) => [key, intensity] as const);
    }),
  );
};
