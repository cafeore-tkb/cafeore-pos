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

export interface BrewObservation {
  /** 統合した2杯も1回として識別する。 */
  dripId: string;
  kind: BrewKind;
  seconds: number;
  finishedAtMs: number;
  /** 学年を含む、確実に識別できる担当者。分からない場合は null。 */
  personKey: string | null;
}

export interface BrewEstimate {
  seconds: number;
  standardSeconds: number;
  coefficient: number;
  standardSamples: number;
  personSamples: number;
}

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * 検証用の暫定モデル。呼び出し元が異常操作・淹れ直し・曖昧な帰属を
 * 除外してから渡す。閾値は前日練習の結果を見て調整する。
 * 過去の基準値に対する比率を使い、当該実績や未来を基準に混ぜない。
 */
export function estimateBrew(
  observations: readonly BrewObservation[],
  kind: BrewKind,
  personKey: string | null,
  atMs: number,
): BrewEstimate {
  const seen = new Set<string>();
  const previous: Record<BrewKind, number[]> = {
    hot1: [],
    hot2: [],
    ice1: [],
    ice2: [],
  };
  const ratios: number[] = [];
  const ordered = [...observations]
    .filter(
      (o) =>
        Number.isFinite(o.finishedAtMs) &&
        o.finishedAtMs < atMs &&
        Number.isFinite(o.seconds) &&
        o.seconds > 0,
    )
    .sort(
      (a, b) =>
        a.finishedAtMs - b.finishedAtMs || a.dripId.localeCompare(b.dripId),
    );
  for (let i = 0; i < ordered.length; ) {
    let end = i + 1;
    while (
      end < ordered.length &&
      ordered[end].finishedAtMs === ordered[i].finishedAtMs
    )
      end++;
    const batch = ordered.slice(i, end).filter((observation) => {
      if (!observation.dripId || seen.has(observation.dripId)) return false;
      seen.add(observation.dripId);
      return true;
    });
    for (const observation of batch) {
      const samples = previous[observation.kind];
      const standard = samples.length
        ? median(samples.slice(-10))
        : INITIAL_BREW_SECONDS[observation.kind];
      if (personKey && observation.personKey === personKey)
        ratios.push(observation.seconds / standard);
    }
    for (const observation of batch)
      previous[observation.kind].push(observation.seconds);
    i = end;
  }
  const standardSamples = previous[kind].slice(-10);
  const standardSeconds = standardSamples.length
    ? median(standardSamples)
    : INITIAL_BREW_SECONDS[kind];
  const personal = ratios.slice(-20);
  const weight = personal.length / (personal.length + 5);
  const coefficient = personal.length ? 1 + weight * (median(personal) - 1) : 1;
  return {
    seconds: Math.round(standardSeconds * coefficient),
    standardSeconds,
    coefficient,
    standardSamples: standardSamples.length,
    personSamples: personal.length,
  };
}
