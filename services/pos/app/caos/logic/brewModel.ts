import type { CaosCard } from "@cafeore/common";

/** 抽出開始から「次へ」までの実測に基づく、4種類の基準時間。 */
export type BrewKind = "hot1" | "hot2" | "ice1" | "ice2";

/** 統合カードも中のカップで判定する。混合・空・3杯以上は学習させない。 */
export function brewKind(card: Pick<CaosCard, "cups">): BrewKind | null {
  if (card.cups.length !== 1 && card.cups.length !== 2) return null;
  const temperatures = card.cups.map((cup) => cup.item.item_type.iced_brew);
  if (temperatures.some((value) => typeof value !== "boolean")) return null;
  if (!temperatures.every((value) => value === temperatures[0])) return null;
  return `${temperatures[0] ? "ice" : "hot"}${card.cups.length}` as BrewKind;
}

export const INITIAL_BREW_SECONDS: Record<BrewKind, number> = {
  hot1: 300,
  hot2: 360,
  ice1: 300,
  ice2: 360,
};
