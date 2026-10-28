import type { CaosCard } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { type BrewObservation, brewKind, estimateBrew } from "./brewModel";

const observation = (
  id: string,
  time: number,
  seconds: number,
  kind: BrewObservation["kind"] = "hot1",
  personKey: string | null = null,
): BrewObservation => ({
  dripId: id,
  finishedAtMs: time,
  seconds,
  kind,
  personKey,
});

describe("[unit] brew model", () => {
  test("統合した別注文もカップ数で分類し、混合や種類不明は除外する", () => {
    const cup = (iced: boolean | undefined) =>
      ({
        item: { item_type: { iced_brew: iced } },
      }) as CaosCard["cups"][number];
    expect(brewKind({ cups: [cup(false)] })).toBe("hot1");
    expect(brewKind({ cups: [cup(true)] })).toBe("ice1");
    expect(brewKind({ cups: [cup(false), cup(false)] })).toBe("hot2");
    expect(brewKind({ cups: [cup(true), cup(true)] })).toBe("ice2");
    expect(brewKind({ cups: [cup(true), cup(false)] })).toBeNull();
    expect(brewKind({ cups: [cup(undefined)] })).toBeNull();
    expect(brewKind({ cups: [] })).toBeNull();
  });
  test("初期値を四種類で使い、有効な直近実績だけが基準に反映される", () => {
    const samples = [
      observation("a", 1, 210),
      observation("b", 2, 240, "ice2"),
      observation("future", 4, 10),
    ];
    expect(estimateBrew(samples, "hot1", null, 3).seconds).toBe(210);
    expect(estimateBrew(samples, "ice2", null, 3).seconds).toBe(240);
    expect(estimateBrew(samples, "hot2", null, 3).seconds).toBe(360);
    expect(estimateBrew(samples, "ice1", null, 3).seconds).toBe(300);
  });

  test("同じ抽出を重複集計せず、異なる種類の本人実績は基準に対する比率でまとめる", () => {
    const samples = [
      observation("a", 1, 240, "hot1", "A/B1"),
      observation("a", 1, 240, "hot1", "A/B1"),
      observation("b", 2, 288, "ice2", "A/B1"),
    ];
    const result = estimateBrew(samples, "hot1", "A/B1", 3);
    expect(result.standardSamples).toBe(1);
    expect(result.personSamples).toBe(2);
    expect(result.coefficient).toBeCloseTo(1 + (2 / 7) * (0.8 - 1));
    expect(estimateBrew(samples, "hot1", null, 3).coefficient).toBe(1);
  });

  test("同時刻の実績同士は互いの個人比率の基準に使わない", () => {
    const samples = [
      observation("a", 1, 150, "hot1"),
      observation("b", 1, 240, "hot1", "A"),
    ];
    expect(estimateBrew(samples, "hot1", "A", 2).coefficient).toBeCloseTo(
      1 + (1 / 6) * (0.8 - 1),
    );
  });
});
