import { describe, expect, test } from "vitest";
import { itemTypeSchema } from "./item";

describe("[unit] itemTypeSchema", () => {
  test("項目を持つ前のデータは既定値で補わずに読まない", () => {
    expect(
      itemTypeSchema.safeParse({
        id: "1",
        name: "milk",
        display_name: "ミルク",
      }).success,
    ).toBe(false);
  });

  test("API の値はそのまま使う", () => {
    // 組み合わせの検査は API の仕事
    const itemType = {
      id: "1",
      name: "x",
      display_name: "x",
      makes_cup: false,
      needs_brew: false,
      senior_only: true,
      iced_brew: true,
    };
    expect(itemTypeSchema.parse(itemType)).toEqual(itemType);
  });
});
