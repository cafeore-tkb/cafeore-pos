import { describe, expect, test } from "vitest";
import { type ColorSetting, resolveItemColor } from "./colorSetting";

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const TYPE_ID = "22222222-2222-4222-8222-222222222222";

const item = { id: ITEM_ID, item_type: { id: TYPE_ID } };

const typeMaster: ColorSetting = {
  id: "33333333-3333-4333-8333-333333333333",
  target_type: "ItemType",
  target_id: TYPE_ID,
  screen: "master",
  color: "#bfdbfe",
};

const itemMaster: ColorSetting = {
  id: "44444444-4444-4444-8444-444444444444",
  target_type: "Item",
  target_id: ITEM_ID,
  screen: "master",
  color: "#86efac",
};

describe("[unit] resolveItemColor", () => {
  test("no settings falls back to default", () => {
    expect(resolveItemColor([], item, "master")).toBeUndefined();
  });

  test("uses item type setting", () => {
    expect(resolveItemColor([typeMaster], item, "master")).toBe("#bfdbfe");
  });

  test("item setting takes priority over item type setting", () => {
    expect(resolveItemColor([typeMaster, itemMaster], item, "master")).toBe(
      "#86efac",
    );
    expect(resolveItemColor([itemMaster, typeMaster], item, "master")).toBe(
      "#86efac",
    );
  });

  test("settings for another screen are ignored", () => {
    expect(
      resolveItemColor([typeMaster, itemMaster], item, "serve"),
    ).toBeUndefined();
  });

  test("target type is not confused when ids collide", () => {
    const sameId = { id: TYPE_ID, item_type: { id: ITEM_ID } };
    expect(resolveItemColor([typeMaster], sameId, "master")).toBeUndefined();
  });
});
