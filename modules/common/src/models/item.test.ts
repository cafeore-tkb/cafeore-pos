import { describe, expect, test } from "vitest";
import { itemTypeSchema } from "./item";

describe("[unit] itemTypeSchema", () => {
  test("項目を持つ前のデータは API の列の既定値と同じにする", () => {
    expect(
      itemTypeSchema.parse({ id: "1", name: "others", display_name: "その他" }),
    ).toEqual({
      id: "1",
      name: "others",
      display_name: "その他",
      makes_cup: true,
      needs_brew: true,
      senior_only: false,
    });
  });

  test("API の値はそのまま使う", () => {
    const itemType = {
      id: "1",
      name: "limited",
      display_name: "限定",
      makes_cup: true,
      needs_brew: true,
      senior_only: true,
    };
    expect(itemTypeSchema.parse(itemType)).toEqual(itemType);
  });
});
