import { describe, expect, test } from "vitest";
import type { WithId } from "../lib/typeguard";
import type { Item, ItemType } from "./item";
import { MenuEntity } from "./menu";
import {
  type SplitChunk,
  planCupSplit,
  planOrderSplit,
  sortOrderLines,
  splitItemKey,
} from "./split-plan";

const hot: ItemType = {
  id: "t1",
  name: "hot",
  display_name: "ホット",
  makes_cup: true,
  needs_brew: true,
  senior_only: false,
  iced_brew: false,
  serve_with_snack: false,
};
const milk: ItemType = {
  ...hot,
  id: "t2",
  name: "milk",
  display_name: "ミルク",
  needs_brew: false,
};

const item = (name: string, type = hot): WithId<Item> => ({
  id: `item-${name}`,
  name,
  abbr: name,
  item_type: type,
});
const [A, B, C] = ["A", "B", "C"].map((name) => item(name));
const milkItem = item("ミルク", milk);

const menuOf = (...items: { item: WithId<Item>; quantity: number }[]) =>
  MenuEntity.fromMenu({
    id: crypto.randomUUID(),
    name: items.map(({ item }) => item.name).join("+"),
    abbr: "m",
    price: 500,
    key: "m",
    items,
    assignee: null,
  });

/** 文字 1 つが 1 杯（例：{ A: 3, B: 1 } → AAAB） */
const cupsOf = (counts: Record<string, number>) =>
  Object.entries(counts).flatMap(([name, n]) => Array<string>(n).fill(name));

/** 番号を ｜ で区切り、まとまりを + でつなぐ。前の注文と同じ商品の 1 杯は小文字 */
const show = (groups: SplitChunk[][]) =>
  groups
    .map((group) =>
      group
        .map((chunk) =>
          (chunk.merge ? chunk.item.toLowerCase() : chunk.item).repeat(
            chunk.size,
          ),
        )
        .join("+"),
    )
    .join("｜");

describe("[unit] planCupSplit", () => {
  // 「注文番号の分け方」の例の表
  test.each([
    [{ A: 3, B: 1 }, [], "AA｜A+B"],
    [{ A: 3, B: 1 }, ["B"], "b+A｜AA"],
    [{ A: 5 }, [], "AA+AA｜A"],
    [{ A: 5 }, ["A"], "a｜AA+AA"],
    [{ A: 4, B: 1 }, [], "AA+AA｜B"],
    [{ A: 3, B: 3 }, [], "AA+BB｜A+B"],
    [{ A: 3, B: 3 }, ["B"], "b+A｜AA+BB"],
    [{ A: 2, B: 2, C: 2 }, [], "AA+BB｜CC"],
    [{ A: 3, B: 1, C: 1 }, [], "AA+A｜B+C"],
    [{ A: 3, B: 1, C: 1 }, ["B"], "b+C｜AA+A"],
    [{ A: 1, B: 1, C: 1, D: 1, E: 1 }, ["D"], "d+A｜B+C｜E"],
    [{ A: 1, B: 1, C: 1, D: 1, E: 1 }, ["C", "D", "E"], "c+d｜e+A｜B"],
    [{ A: 3, B: 1, C: 1 }, ["A", "B", "C"], "a+b｜c+AA"],
  ])("%o・前の注文 %o → %s", (counts, prev, plan) => {
    expect(show(planCupSplit(cupsOf(counts), prev))).toBe(plan);
  });

  test("まとまりが 2 つまでなら分けない", () => {
    const cases: Record<string, number>[] = [
      { A: 4 },
      { A: 2, B: 2 },
      { A: 2, B: 1 },
      { A: 3 },
    ];
    for (const counts of cases) {
      expect(planCupSplit(cupsOf(counts), ["A"])).toHaveLength(1);
    }
  });
});

describe("[unit] planOrderSplit", () => {
  const line = (key: string, ...items: [WithId<Item>, number][]) => ({
    key,
    menu: menuOf(...items.map(([item, quantity]) => ({ item, quantity }))),
  });

  test("1 杯の行を番号に割り振り、ミルク・グッズは 1 つ目の番号に入れる", () => {
    const lines = [
      line("a1", [A, 1]),
      line("a2", [A, 1]),
      line("m", [milkItem, 1]),
      line("a3", [A, 1]),
      line("b", [B, 1]),
    ];
    // AA｜A+B
    expect(planOrderSplit(lines, [])).toEqual([
      ["a1", "a2", "m"],
      ["a3", "b"],
    ]);
    // 前の注文に B の 1 杯があれば、B を先頭の番号の先頭に入れる（b+A｜AA）
    expect(planOrderSplit(lines, [splitItemKey(B)])).toEqual([
      ["b", "a1", "m"],
      ["a2", "a3"],
    ]);
  });

  test("同じ商品 2 杯の行は 2 杯のまとまりに当て、分けない", () => {
    const lines = [
      line("a", [A, 1]),
      line("pair", [A, 2], [milkItem, 1]),
      line("b", [B, 1]),
      line("c", [C, 1]),
    ];
    // AA+A｜B+C。2 杯のまとまりはセットの行
    expect(planOrderSplit(lines, [])).toEqual([
      ["a", "pair"],
      ["b", "c"],
    ]);
  });

  test("違う商品の組み合わせ・3 杯以上の行は、それだけで 1 つの番号にする", () => {
    const lines = [
      line("a", [A, 1]),
      line("b", [B, 1]),
      line("mixed", [A, 1], [C, 1]),
      line("triple", [C, 3]),
    ];
    expect(planOrderSplit(lines, [])).toEqual([
      ["a", "b"],
      ["mixed"],
      ["triple"],
    ]);
  });

  test("分けなくてよければ null", () => {
    expect(planOrderSplit([line("a", [A, 2]), line("b", [B, 1])], [])).toBe(
      null,
    );
    expect(planOrderSplit([line("m", [milkItem, 3])], [])).toBe(null);
  });
});

describe("[unit] sortOrderLines", () => {
  const line = (key: string, item: WithId<Item>, quantity = 1) => ({
    key,
    menu: menuOf({ item, quantity }),
  });

  test("planOrderSplit の番号の順に並べる（番号は分けない）", () => {
    const lines = [
      line("a1", A),
      line("a2", A),
      line("m", milkItem),
      line("a3", A),
      line("b", B),
    ];
    // b+A｜AA
    expect(sortOrderLines(lines, [splitItemKey(B)])).toEqual([
      "b",
      "a1",
      "m",
      "a2",
      "a3",
    ]);
  });

  test("前の注文と同じ商品の 1 杯を組の先に並べる（後から入れても）", () => {
    const lines = [line("b", B), line("a", A), line("c", C)];
    // a+B｜C。B を先に入れても A・B の順
    expect(sortOrderLines(lines, [splitItemKey(A)])).toEqual(["a", "b", "c"]);
    // 2 杯と組んでも 1 杯が先（a+BB｜CC+DD）
    const D = item("D");
    const pairs = [line("bb", B, 2), line("a", A), line("cc", C, 2)];
    expect(
      sortOrderLines([...pairs, line("dd", D, 2)], [splitItemKey(A)]),
    ).toEqual(["a", "bb", "cc", "dd"]);
  });

  test("前の注文と同じ商品の 1 杯どうしは入れた順", () => {
    const lines = [line("b", B), line("a", A), line("c", C)];
    // b+a｜C
    expect(sortOrderLines(lines, [splitItemKey(A), splitItemKey(B)])).toEqual([
      "b",
      "a",
      "c",
    ]);
  });

  test("分けなくてよい注文は入れた順のまま", () => {
    const lines = [line("b", B), line("a", A, 2), line("m", milkItem)];
    expect(sortOrderLines(lines, [splitItemKey(A)])).toEqual(["b", "a", "m"]);
  });
});
