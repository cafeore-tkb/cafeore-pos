import { type ItemType, MenuEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  type CashierDraft,
  activeMenus,
  cashierKeyIntent,
  emptyCashierDraft,
} from "./cashierDraft";
import { beginRest } from "./cashierSplit";
import {
  type HeldKeys,
  emptyHeldKeys,
  heldKeyValues,
  heldLineKeys,
  pressKey,
  releaseKey,
  rememberAddedLine,
} from "./heldKeys";

const itemType: ItemType = {
  id: "others",
  name: "others",
  display_name: "others",
  makes_cup: false,
  needs_brew: false,
  senior_only: false,
  iced_brew: false,
  needs_finishing: false,
};

const menu = (id: string, key: string) =>
  MenuEntity.fromMenu({
    id,
    name: id,
    abbr: id,
    price: 300,
    key,
    items: [
      { item: { id, name: id, abbr: id, item_type: itemType }, quantity: 1 },
    ],
    assignee: null,
  });

const menus = [
  menu("A", "a"),
  menu("S", "s"),
  menu("X", "x"),
  menu("AS", "a+s"),
  menu("ASD", "s+d+a"),
  menu("QW", "q+w"),
];
const payments = ["cash"] as const;

type Register = { draft: CashierDraft; held: HeldKeys };

const start = (draft = emptyCashierDraft()): Register => ({
  draft,
  held: emptyHeldKeys(),
});

/** レジの画面（CashierV2）と同じように、キーを押して下書きを変える */
const down = (
  { draft, held }: Register,
  key: string,
  { code = `Key${key.toUpperCase()}`, repeat = false } = {},
): Register => {
  const pressed = pressKey(held, code, key);
  const intent = cashierKeyIntent(draft, key, {
    menus,
    payments,
    held: heldKeyValues(pressed),
    heldLineKeys: heldLineKeys(pressed),
    repeat,
  });
  if (intent.type !== "update") return { draft, held: pressed };
  return {
    draft: intent.draft,
    held: rememberAddedLine(pressed, draft, intent.draft),
  };
};

const up = (register: Register, key: string): Register => ({
  ...register,
  held: releaseKey(register.held, `Key${key.toUpperCase()}`),
});

const names = ({ draft }: Register) =>
  activeMenus(draft).map((menu) => menu.name);

describe("[unit] 同時押しの商品キー", () => {
  test("同時押しがそろったら、先に押したキーで足した行を同時押しの商品に置き換える", () => {
    const register = down(down(start(), "a"), "s");
    expect(names(register)).toEqual(["AS"]);
    expect(register.draft.selected).toBe(0);
  });

  test("押す順に関わらず同時押しになる", () => {
    expect(names(down(down(start(), "s"), "a"))).toEqual(["AS"]);
  });

  test("3 つの同時押しは、2 つの同時押しで足した行を置き換える", () => {
    expect(names(down(down(down(start(), "a"), "s"), "d"))).toEqual(["ASD"]);
  });

  test("1 つだけでは商品の無いキーも、同時押しで足す。1 つだけのときは既定の動きを止める", () => {
    expect(
      cashierKeyIntent(emptyCashierDraft(), "q", { menus, payments }).type,
    ).toBe("none");
    expect(names(down(down(start(), "q"), "w"))).toEqual(["QW"]);
  });

  test("離してから押したキーは同時押しにならない", () => {
    expect(names(down(up(down(start(), "a"), "a"), "s"))).toEqual(["A", "S"]);
  });

  test("前に足した行は置き換えない", () => {
    const register = down(down(up(down(start(), "a"), "a"), "a"), "s");
    expect(names(register)).toEqual(["A", "AS"]);
  });

  test("押したままの繰り返しでは足し直さず、片方を押し直すともう 1 つ足す", () => {
    const held = down(down(start(), "a"), "s");
    expect(names(down(held, "s", { repeat: true }))).toEqual(["AS"]);
    expect(names(down(up(held, "s"), "s"))).toEqual(["AS", "AS"]);
  });

  test("同時押しに無いキーを一緒に押したときは、それぞれのキーで足す", () => {
    expect(names(down(down(start(), "a"), "x"))).toEqual(["A", "X"]);
  });

  test("Shift などを押し足しても、同時押しの商品を足し直さない", () => {
    const { draft, held } = down(down(start(), "a"), "s");
    const intent = cashierKeyIntent(draft, "Shift", {
      menus,
      payments,
      held: heldKeyValues(held),
      heldLineKeys: heldLineKeys(held),
    });
    expect(intent.type).toBe("ignore");
  });

  test("会計の段階では同時押しでも足さない", () => {
    const paying = start(beginRest(down(start(), "x").draft, 0, 100));
    expect(names(down(down(paying, "a"), "s"))).toEqual(["X"]);
  });

  test("Shift で key が変わっても、離したキーは code で忘れる", () => {
    const held = pressKey(emptyHeldKeys(), "KeyA", "a");
    expect(heldKeyValues(releaseKey(held, "KeyA"))).toEqual([]);
  });

  test("押したまま注文を送って番号が振り直されたら、前の注文で足した行は置き換えない", () => {
    const sent = { ...down(start(), "a"), draft: emptyCashierDraft() };
    // a を押したまま、新しい注文に X を足して離す（X も番号 0）
    const added = up(down(sent, "x"), "x");
    expect(names(down(added, "s"))).toEqual(["X", "AS"]);
  });
});
