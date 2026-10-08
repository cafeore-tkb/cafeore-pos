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
    const itemType = {
      id: "1",
      name: "limited",
      display_name: "限定",
      makes_cup: true,
      needs_brew: true,
      senior_only: true,
      iced_brew: false,
    };
    expect(itemTypeSchema.parse(itemType)).toEqual(itemType);
    const iced = {
      ...itemType,
      name: "ice",
      display_name: "アイス",
      senior_only: false,
      iced_brew: true,
    };
    expect(itemTypeSchema.parse(iced)).toEqual(iced);
  });
});
