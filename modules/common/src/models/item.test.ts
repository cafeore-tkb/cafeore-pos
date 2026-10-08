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
      iced_brew: false,
    });
  });

  test("API の値はそのまま使う", () => {
    // どの項目も既定値と違う値にして、既定値で上書きされないことを見る（組み合わせの検査は API の仕事）
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
