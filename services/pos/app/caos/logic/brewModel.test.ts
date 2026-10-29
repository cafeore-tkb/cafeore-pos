import type { CaosCard } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import { brewKind } from "./brewModel";

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
});
