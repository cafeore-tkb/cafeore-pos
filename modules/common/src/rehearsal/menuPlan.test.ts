import { describe, expect, test } from "vitest";
import { xoshiro128ss } from "./generator";
import {
  type MenuPlan,
  evenPlan,
  initialPlan,
  lastYearPlan,
  matchPastItem,
  pastItemShares,
  pastRoleShares,
  planOrder,
  reweightBaskets,
  roleSharesOf,
  unassignedRoles,
} from "./menuPlan";
import type { Basket, GeneratorParams } from "./params";

const baskets: Basket[] = [
  { roles: { house_blend: 1 }, goods: 0, weight: 50 },
  { roles: { house_blend: 2 }, goods: 0, weight: 10 },
  { roles: { single_origin: 1 }, goods: 0, weight: 20 },
  { roles: { single_origin: 1, ice_ore: 1 }, goods: 0, weight: 10 },
  { roles: { ice_ore: 1 }, goods: 1, weight: 10 },
  { roles: {}, goods: 1, weight: 5 },
];

const params: GeneratorParams = {
  version: 2,
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
      role: "house_blend",
      counts: { "2024": 10, "2025": 60 },
    },
    {
      id: "05_pink_bourbon",
      name: "ピンクブルボン",
      role: "single_origin",
      counts: { "2025": 15 },
    },
    {
      id: "06_toraja",
      name: "トラジャ",
      role: "single_origin",
      counts: { "2025": 5 },
    },
    {
      id: "04_mandheling",
      name: "マンデリン",
      role: "single_origin",
      counts: { "2024": 30 },
    },
    {
      id: "30_ice_ore",
      name: "アイスオレ",
      role: "ice_ore",
      counts: { "2025": 20 },
    },
    {
      id: "52_tote",
      name: "トートバッグ",
      role: "goods",
      counts: { "2025": 4 },
    },
  ],
};

const menus = [
  { id: "m-house", name: "珈琲・俺ブレンド" },
  { id: "m-pink", name: "ピンクブルボン" },
  { id: "m-new", name: "エチオピア" },
  { id: "m-ore", name: "アイスオレ" },
  { id: "m-set", name: "ブレンドとトートのセット" },
  { id: "m-tote", name: "トートバッグ" },
];

describe("[unit] rehearsal menu plan", () => {
  test("last year's role shares count only that year's cups", () => {
    const shares = pastRoleShares(params, "2025");
    expect(shares.house_blend).toBeCloseTo(60);
    expect(shares.single_origin).toBeCloseTo(20);
    expect(shares.ice_ore).toBeCloseTo(20);
    expect(shares.premium).toBe(0);
  });

  test("menus are matched to past items by name", () => {
    expect(matchPastItem(params, "ピンクブルボン")?.id).toBe("05_pink_bourbon");
    expect(matchPastItem(params, " アイスオレ ")?.id).toBe("30_ice_ore");
    expect(matchPastItem(params, "エチオピア")).toBeNull();
  });

  test("the initial plan puts only name-matched menus into a role", () => {
    const plan = initialPlan(params, menus);
    expect(plan.menus["m-house"].role).toBe("house_blend");
    expect(plan.menus["m-pink"].role).toBe("single_origin");
    expect(plan.menus["m-tote"].role).toBe("goods");
    expect(plan.menus["m-new"].role).toBeNull();
    expect(plan.menus["m-set"].role).toBeNull();
  });

  test("same as last year: matched menus take last year's share, new ones split the rest", () => {
    const current: MenuPlan = {
      ...initialPlan(params, menus),
    };
    current.menus["m-new"] = { role: "single_origin", weight: 0 };
    const plan = lastYearPlan(params, menus, current);
    // 2025 のシングルは ピンクブルボン 75% / トラジャ 25%。トラジャは今年無いので新メニューへ
    expect(plan.menus["m-pink"].weight).toBeCloseTo(75);
    expect(plan.menus["m-new"].weight).toBeCloseTo(25);
    expect(plan.roleShares.house_blend).toBeCloseTo(60);
  });

  test("a role whose menus match nothing is split evenly", () => {
    const current = initialPlan(params, menus);
    current.menus["m-house"] = { role: null, weight: 0 };
    current.menus["m-set"] = { role: "house_blend", weight: 0 };
    const plan = lastYearPlan(params, menus, current);
    expect(plan.menus["m-set"].weight).toBeCloseTo(100);
  });

  test("evenPlan splits each role evenly", () => {
    const plan = evenPlan({
      version: 1,
      roleShares: {},
      menus: {
        a: { role: "single_origin", weight: 90 },
        b: { role: "single_origin", weight: 10 },
        c: { role: null, weight: 5 },
      },
    });
    expect(plan.menus.a.weight).toBeCloseTo(50);
    expect(plan.menus.b.weight).toBeCloseTo(50);
    expect(plan.menus.c.weight).toBe(0);
  });

  test("unassignedRoles lists roles with a share but no menu", () => {
    expect(
      unassignedRoles({
        version: 1,
        roleShares: { house_blend: 50, ice_ore: 50, premium: 0 },
        menus: { a: { role: "house_blend", weight: 100 } },
      }),
    ).toEqual(["ice_ore"]);
  });

  test("reweightBaskets hits the target role shares and keeps goods-only orders", () => {
    const target = { house_blend: 30, single_origin: 50, ice_ore: 20 };
    const reweighted = reweightBaskets(baskets, target);
    const shares = roleSharesOf(reweighted);
    expect(shares.house_blend).toBeCloseTo(0.3, 2);
    expect(shares.single_origin).toBeCloseTo(0.5, 2);
    expect(shares.ice_ore).toBeCloseTo(0.2, 2);
    expect(reweighted[5].weight).toBe(5);
    // 2 杯の組は 2 杯のまま（組は壊さない）
    expect(reweighted[1].roles).toEqual({ house_blend: 2 });
  });

  test("a role with 0% drops every basket that contains it", () => {
    const reweighted = reweightBaskets(baskets, {
      house_blend: 50,
      single_origin: 50,
      ice_ore: 0,
    });
    expect(reweighted[3].weight).toBeCloseTo(0, 6);
    expect(reweighted[4].weight).toBeCloseTo(0, 6);
    expect(roleSharesOf(reweighted).single_origin).toBeCloseTo(0.5, 2);
  });

  test("planOrder replaces cups and goods with menus and groups the same menu", () => {
    const plan: MenuPlan = {
      version: 1,
      roleShares: {},
      menus: {
        "m-house": { role: "house_blend", weight: 100 },
        "m-tote": { role: "goods", weight: 100 },
      },
    };
    const lines = planOrder(
      {
        offsetSec: 0,
        roles: { house_blend: 2, ice_ore: 1 },
        drinkCups: 3,
        goods: 1,
      },
      plan,
      xoshiro128ss(1),
    );
    expect(lines).toEqual([
      { menuId: "m-house", role: "house_blend", count: 2 },
      { menuId: null, role: "ice_ore", count: 1 },
      { menuId: "m-tote", role: "goods", count: 1 },
    ]);
  });

  test("planOrder draws menus within a role by weight", () => {
    const plan: MenuPlan = {
      version: 1,
      roleShares: {},
      menus: {
        a: { role: "single_origin", weight: 80 },
        b: { role: "single_origin", weight: 20 },
      },
    };
    const rng = xoshiro128ss(5);
    let a = 0;
    for (let i = 0; i < 5000; i++) {
      const [line] = planOrder(
        { offsetSec: 0, roles: { single_origin: 1 }, drinkCups: 1, goods: 0 },
        plan,
        rng,
      );
      if (line.menuId === "a") a++;
    }
    expect(a / 5000).toBeGreaterThan(0.77);
    expect(a / 5000).toBeLessThan(0.83);
  });

  describe("2025: 縁ブレンドとも花も香ブレンド、トートセット", () => {
    // 2025 年祭の実数。縁ブレンドの 46 杯はトートセットの中の ¥0 のドリンク
    const festival: GeneratorParams = {
      ...params,
      items: [
        {
          id: "01_yukari_brend",
          name: "縁ブレンド",
          role: "signature_blend",
          counts: { "2025": 317 },
        },
        {
          id: "08_special_mocha_blend",
          name: "も花も香ブレンド",
          role: "signature_blend",
          counts: { "2025": 85 },
        },
        {
          id: "51_tote_yukari",
          name: "トートセット",
          role: "goods",
          counts: { "2025": 46 },
        },
        {
          id: "50_coaster",
          name: "コースター",
          role: "goods",
          counts: { "2025": 62 },
        },
      ],
    };

    test("the two blends count as one 看板ブレンド and the set is shown in that role", () => {
      const rows = pastItemShares(festival, "2025", "signature_blend");
      expect(rows.map((r) => [r.name, r.count])).toEqual([
        ["縁ブレンド・も花も香ブレンド", 356],
        ["トートセット", 46],
      ]);
      expect(rows[1].share).toBeCloseTo((100 * 46) / 402);
      // 物販の内訳にはセットを出さない
      expect(
        pastItemShares(festival, "2025", "goods").map((r) => r.name),
      ).toEqual(["コースター"]);
    });

    test("either blend name matches the merged entry, and the set matches by name", () => {
      expect(matchPastItem(festival, "縁ブレンド")?.id).toBe("signature_2025");
      expect(matchPastItem(festival, "も花も香ブレンド")?.id).toBe(
        "signature_2025",
      );
      expect(matchPastItem(festival, "トートセット")?.role).toBe(
        "signature_blend",
      );
    });

    test("same as last year gives a new blend and a new set last year's split", () => {
      const plan = lastYearPlan(
        festival,
        [
          { id: "blend", name: "新しい看板ブレンド" },
          { id: "set", name: "新しいトートのセット" },
        ],
        {
          version: 1,
          roleShares: {},
          menus: {
            blend: { role: "signature_blend", weight: 0 },
            set: { role: "signature_blend", weight: 0 },
          },
        },
      );
      // 名前が当たらないので等分になる。名前を去年にそろえれば去年の割合が入る
      expect(plan.menus.blend.weight).toBeCloseTo(50);

      const named = lastYearPlan(
        festival,
        [
          { id: "blend", name: "縁ブレンド" },
          { id: "set", name: "トートセット" },
        ],
        {
          version: 1,
          roleShares: {},
          menus: {
            blend: { role: "signature_blend", weight: 0 },
            set: { role: "signature_blend", weight: 0 },
          },
        },
      );
      expect(named.menus.blend.weight).toBeCloseTo((100 * 356) / 402);
      expect(named.menus.set.weight).toBeCloseTo((100 * 46) / 402);
    });
  });

  test("a set that already holds goods takes them out of the order's goods", () => {
    const plan: MenuPlan = {
      version: 1,
      roleShares: {},
      menus: {
        set: { role: "signature_blend", weight: 100 },
        coaster: { role: "goods", weight: 100 },
      },
    };
    const lines = planOrder(
      { offsetSec: 0, roles: { signature_blend: 1 }, drinkCups: 1, goods: 2 },
      plan,
      xoshiro128ss(1),
      { set: 1 },
    );
    expect(lines).toEqual([
      { menuId: "set", role: "signature_blend", count: 1 },
      { menuId: "coaster", role: "goods", count: 1 },
    ]);
  });
});
