import { describe, expect, test } from "vitest";
import { xoshiro128ss } from "./generator";
import {
  type MenuPlan,
  type PlanMenu,
  goodsInMenu,
  initialPlan,
  menuType,
  pastItemShares,
  pastTypeShares,
  pastTypes,
  planOrder,
  reweightBaskets,
  typeSharesOf,
  unassignedTypes,
} from "./menuPlan";
import type { Basket, GeneratorParams } from "./params";

const baskets: Basket[] = [
  { types: { hot: 1 }, weight: 50 },
  { types: { hot: 2 }, weight: 10 },
  { types: { ice: 1 }, weight: 20 },
  { types: { ice: 1, iceOre: 1 }, weight: 10 },
  { types: { iceOre: 1, others: 1 }, weight: 10 },
  { types: { others: 1 }, weight: 5 },
];

const params: GeneratorParams = {
  version: 3,
  source: { dates: [], orders: 0 },
  binMinutes: 10,
  edges: [0.8, 1, 1.2],
  gapsByStratum: [[60], [50], [40], [30]],
  baskets,
  days: [],
  items: [
    {
      id: "02_cafeore_brend",
      name: "珈琲・俺ブレンド",
      type: "hot",
      counts: { "2024": 10, "2025": 45 },
    },
    {
      id: "05_pink_bourbon",
      name: "ピンクブルボン",
      type: "hot",
      counts: { "2025": 15 },
    },
    {
      id: "30_ice_ore",
      name: "アイスオレ",
      type: "iceOre",
      counts: { "2024": 30, "2025": 30 },
    },
    {
      id: "52_tote",
      name: "トートバッグ",
      type: "others",
      counts: { "2025": 10 },
    },
  ],
};

const itemOf = (name: string, makes_cup = true) => ({
  item_type: { name, makes_cup },
});

const menu = (
  id: string,
  ...items: [string, number, boolean?][]
): PlanMenu => ({
  id,
  name: id,
  items: items.map(([type, quantity, cup]) => ({
    quantity,
    item: itemOf(type, cup ?? true),
  })),
});

const house = menu("house", ["hot", 1]);
const pink = menu("pink", ["hot", 1]);
const ore = menu("ore", ["iceOre", 1]);
const tote = menu("tote", ["others", 1, false]);
const set = menu("set", ["hot", 1], ["others", 1, false]);
const double = menu("double", ["hot", 2]);
const menus = [house, pink, ore, tote, set, double];

const plan = (weights: Record<string, number> = {}): MenuPlan => ({
  version: 2,
  typeShares: {},
  weights,
});

describe("[unit] rehearsal menu plan", () => {
  test("the type of a menu comes from the item types in the DB", () => {
    expect(menuType(house)).toBe("hot");
    expect(menuType(tote)).toBe("others");
    // 物販の付いたセットはドリンクの種類で 1 個ぶん
    expect(menuType(set)).toBe("hot");
    expect(goodsInMenu(set)).toEqual({ others: 1 });
    expect(goodsInMenu(tote)).toEqual({});
    // 2 杯以上のセット・物販 2 個は出さない
    expect(menuType(double)).toBeNull();
    expect(menuType(menu("two-goods", ["others", 2, false]))).toBeNull();
  });

  test("last year's type shares count only that year", () => {
    const shares = pastTypeShares(params, "2025");
    expect(shares.hot).toBeCloseTo(60);
    expect(shares.iceOre).toBeCloseTo(30);
    expect(shares.others).toBeCloseTo(10);
    expect(pastTypes(params)).toEqual(["hot", "iceOre", "others"]);
  });

  test("the breakdown of a type lists last year's items", () => {
    const rows = pastItemShares(params, "2025", "hot");
    expect(rows.map((r) => [r.name, r.count])).toEqual([
      ["珈琲・俺ブレンド", 45],
      ["ピンクブルボン", 15],
    ]);
    expect(rows[0].share).toBeCloseTo(75);
  });

  test("the initial plan keeps last year's type shares and splits each type evenly", () => {
    const initial = initialPlan(params);
    expect(initial.typeShares.hot).toBeCloseTo(60);
    expect(initial.weights).toEqual({});
  });

  test("unassignedTypes lists types with a share but no menu to draw", () => {
    expect(
      unassignedTypes(
        {
          version: 2,
          typeShares: { hot: 50, iceOre: 40, ice: 10, milk: 0 },
          weights: { ore: 0 },
        },
        menus,
      ),
    ).toEqual(["ice", "iceOre"]);
  });

  test("reweightBaskets hits the target type shares", () => {
    const target = { hot: 30, ice: 40, iceOre: 20, others: 10 };
    const reweighted = reweightBaskets(baskets, target);
    const shares = typeSharesOf(reweighted);
    expect(shares.hot).toBeCloseTo(0.3, 2);
    expect(shares.ice).toBeCloseTo(0.4, 2);
    expect(shares.iceOre).toBeCloseTo(0.2, 2);
    expect(shares.others).toBeCloseTo(0.1, 2);
    // 2 杯の組は 2 杯のまま（組は壊さない）
    expect(reweighted[1].types).toEqual({ hot: 2 });
  });

  test("a type with 0% drops every basket that contains it", () => {
    const reweighted = reweightBaskets(baskets, {
      hot: 50,
      ice: 50,
      iceOre: 0,
      others: 0,
    });
    expect(reweighted[3].weight).toBeCloseTo(0, 6);
    expect(reweighted[4].weight).toBeCloseTo(0, 6);
    expect(typeSharesOf(reweighted).ice).toBeCloseTo(0.5, 2);
  });

  test("planOrder replaces each unit with a menu and groups the same menu", () => {
    const lines = planOrder(
      { offsetSec: 0, types: { hot: 2, milk: 1, others: 1 } },
      plan({ pink: 0, set: 0 }),
      menus,
      xoshiro128ss(1),
    );
    expect(lines).toEqual([
      { menuId: "house", type: "hot", count: 2 },
      { menuId: null, type: "milk", count: 1 },
      { menuId: "tote", type: "others", count: 1 },
    ]);
  });

  test("planOrder draws menus within a type by weight, evenly by default", () => {
    const share = (weights: Record<string, number>) => {
      const rng = xoshiro128ss(5);
      let n = 0;
      for (let i = 0; i < 5000; i++) {
        const [line] = planOrder(
          { offsetSec: 0, types: { iceOre: 1 } },
          plan(weights),
          [ore, menu("ore2", ["iceOre", 1])],
          rng,
        );
        if (line.menuId === "ore") n++;
      }
      return n / 5000;
    };
    expect(share({})).toBeGreaterThan(0.47);
    expect(share({})).toBeLessThan(0.53);
    expect(share({ ore: 4 })).toBeGreaterThan(0.77);
    expect(share({ ore: 4 })).toBeLessThan(0.83);
  });

  test("a set that already holds goods takes them out of the order's goods", () => {
    const lines = planOrder(
      { offsetSec: 0, types: { hot: 1, others: 2 } },
      plan({ house: 0, pink: 0 }),
      menus,
      xoshiro128ss(1),
    );
    expect(lines).toEqual([
      { menuId: "set", type: "hot", count: 1 },
      { menuId: "tote", type: "others", count: 1 },
    ]);
  });
});
