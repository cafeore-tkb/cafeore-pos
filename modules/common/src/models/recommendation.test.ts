import { describe, expect, test } from "vitest";
import type { WithId } from "../lib/typeguard";
import type { Item } from "./item";
import { MenuEntity } from "./menu";
import { shouldSplitOrder } from "./recommendation";

const hot = { id: "t1", name: "hot", display_name: "ホット" };
const milk = { id: "t2", name: "milk", display_name: "ミルク" };
const others = { id: "t3", name: "others", display_name: "その他" };

const blendA: WithId<Item> = {
  id: crypto.randomUUID(),
  name: "A",
  abbr: "A",
  item_type: hot,
};
const blendB: WithId<Item> = {
  id: crypto.randomUUID(),
  name: "B",
  abbr: "B",
  item_type: hot,
};
const blendC: WithId<Item> = {
  id: crypto.randomUUID(),
  name: "C",
  abbr: "C",
  item_type: hot,
};
const milkItem: WithId<Item> = {
  id: crypto.randomUUID(),
  name: "ミルク",
  abbr: "ミ",
  item_type: milk,
};
const tote: WithId<Item> = {
  id: crypto.randomUUID(),
  name: "トート",
  abbr: "ト",
  item_type: others,
};

const menuOf = (
  items: { item: WithId<Item>; quantity: number }[],
  name = "menu",
) =>
  MenuEntity.fromMenu({
    id: crypto.randomUUID(),
    name,
    abbr: name,
    price: 500,
    key: name,
    items,
    assignee: null,
  });

const times = (n: number, item: WithId<Item>) =>
  Array.from({ length: n }, () => menuOf([{ item, quantity: 1 }]));

describe("[unit] shouldSplitOrder", () => {
  test("1種類なら4杯まで分割しない", () => {
    expect(shouldSplitOrder(times(4, blendA))).toBe(false);
    expect(shouldSplitOrder(times(5, blendA))).toBe(true);
  });

  test("2種類なら各2杯まで分割しない", () => {
    expect(shouldSplitOrder([...times(2, blendA), ...times(2, blendB)])).toBe(
      false,
    );
    expect(shouldSplitOrder([...times(3, blendA), ...times(1, blendB)])).toBe(
      true,
    );
  });

  test("3種類以上なら分割する", () => {
    expect(
      shouldSplitOrder([
        ...times(1, blendA),
        ...times(1, blendB),
        ...times(1, blendC),
      ]),
    ).toBe(true);
  });

  test("ミルクとその他は数えない", () => {
    expect(
      shouldSplitOrder([
        ...times(4, blendA),
        ...times(3, milkItem),
        ...times(3, tote),
      ]),
    ).toBe(false);
  });

  test("セットメニューは中のコーヒーで数える", () => {
    const toteSet = () =>
      menuOf(
        [
          { item: blendA, quantity: 1 },
          { item: tote, quantity: 1 },
        ],
        "トートセット",
      );
    // セットの中のAと単品のAは同じ種類として数える
    expect(shouldSplitOrder([toteSet(), toteSet(), ...times(2, blendA)])).toBe(
      false,
    );
    expect(shouldSplitOrder([toteSet(), ...times(4, blendA)])).toBe(true);
  });

  test("構成品の数量を杯数として数える", () => {
    expect(shouldSplitOrder([menuOf([{ item: blendA, quantity: 4 }])])).toBe(
      false,
    );
    expect(
      shouldSplitOrder([
        menuOf([
          { item: blendA, quantity: 3 },
          { item: blendB, quantity: 1 },
        ]),
      ]),
    ).toBe(true);
  });
});
