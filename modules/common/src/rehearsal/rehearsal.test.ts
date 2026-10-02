import { describe, expect, test } from "vitest";
import {
  flatProfile,
  generateOrders,
  minGapSec,
  mulberry32,
  sampleBaskets,
  scaleOfLevel,
} from "./generator";
import {
  type GeneratorParams,
  type RawOrder,
  fitParams,
  quantile,
  stratumOf,
  tagDay,
} from "./params";
import {
  FESTIVAL_STACK_MODEL,
  RESUME_MIN,
  STOP_MIN,
  serviceMin,
  shouldStop,
  stackAt,
} from "./stopRule";

// 日本時間 2025-11-02 10:00 を起点に、秒数で注文を置く
const at = (sec: number) =>
  new Date(Date.parse("2025-11-02T01:00:00Z") + sec * 1000).toISOString();

const order = (orderId: number, sec: number, items: string[]): RawOrder => ({
  orderId,
  createdAt: at(sec),
  readyAt: at(sec + 300),
  items: items.map((id) => ({ id })),
});

const params: GeneratorParams = {
  version: 2,
  source: { dates: ["2025-11-02"], orders: 0 },
  binMinutes: 10,
  edges: [0.8, 1.0, 1.2],
  gapsByStratum: [
    [100, 120],
    [60, 80],
    [40, 50],
    [20, 30],
  ],
  baskets: [
    { roles: { house_blend: 1 }, goods: 0, weight: 3 },
    { roles: { ice_ore: 2 }, goods: 0, weight: 1 },
  ],
  days: [],
  items: [],
};

describe("[unit] rehearsal params", () => {
  test("quantile matches pandas linear interpolation", () => {
    expect(quantile([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75);
    expect(quantile([1, 2, 3, 4], 0.5)).toBeCloseTo(2.5);
    expect(quantile([5], 0.75)).toBe(5);
  });

  test("stratumOf puts a rate on an edge into the upper stratum", () => {
    expect(stratumOf(0.7, [0.8, 1.0, 1.2])).toBe(0);
    expect(stratumOf(0.8, [0.8, 1.0, 1.2])).toBe(1);
    expect(stratumOf(1.5, [0.8, 1.0, 1.2])).toBe(3);
  });

  // 10 分ビンに 2・4・6・9 件（最後のビンは最後の注文で終わる）。レートは 0.2 / 0.4 / 0.6 / 0.9 件/分
  const secs = [
    0, 300, 600, 750, 900, 1050, 1200, 1300, 1400, 1500, 1600, 1700, 1800, 1875,
    1950, 2025, 2100, 2175, 2250, 2325, 2400,
  ];
  const day = secs.map((sec, i) =>
    order(
      i + 1,
      sec,
      i % 3 === 0 ? ["30_ice_ore", "50_coaster"] : ["02_cafeore_brend"],
    ),
  );

  test("fitParams splits orders into strata by the rate of their bin", () => {
    const fitted = fitParams(
      [
        ...day,
        { ...order(100, 1250, ["30_ice_ore"]), readyAt: null }, // 壊れたレコードは落とす
        order(101, 86400, ["10_ice_coffee"]), // 対象外の日
      ],
      ["2025-11-02"],
    );

    expect(fitted.source.orders).toBe(21);
    expect(fitted.edges).toEqual([0.4, 0.6, 0.9]);
    expect(fitted.gapsByStratum).toEqual([
      [300],
      [300, 150, 150, 150],
      [150, 100, 100, 100, 100, 100],
      [100, 75, 75, 75, 75, 75, 75, 75, 75],
    ]);
    expect(fitted.days).toEqual([
      {
        date: "2025-11-02",
        openAt: "10:00:00",
        durationMin: 40,
        binRates: [0.2, 0.4, 0.6, 0.9],
      },
    ]);
    expect(fitted.items).toEqual([
      {
        id: "02_cafeore_brend",
        name: "02_cafeore_brend",
        role: "house_blend",
        counts: { "2025": 14 },
      },
      {
        id: "30_ice_ore",
        name: "30_ice_ore",
        role: "ice_ore",
        counts: { "2025": 7 },
      },
      {
        id: "50_coaster",
        name: "50_coaster",
        role: "goods",
        counts: { "2025": 7 },
      },
    ]);
  });

  test("fitParams counts identical baskets together", () => {
    const fitted = fitParams(day, ["2025-11-02"]);
    expect(fitted.baskets).toEqual([
      { roles: { house_blend: 1 }, goods: 0, weight: 14 },
      { roles: { ice_ore: 1 }, goods: 1, weight: 7 },
    ]);
  });

  test("gaps over 5000 seconds are treated as a break", () => {
    const tagged = tagDay(
      [
        order(1, 0, []),
        order(2, 60, []),
        order(3, 5061, []),
        order(4, 5100, []),
      ],
      600_000,
    );
    expect(tagged.tagged.map((t) => t.gapSec)).toEqual([null, 60, null, 39]);
  });

  test("fitParams stops on an unknown item id", () => {
    expect(() =>
      fitParams([...day, order(100, 2400, ["99_unknown"])], ["2025-11-02"]),
    ).toThrow("99_unknown");
  });
});

describe("[unit] rehearsal generator", () => {
  test("same seed gives the same orders", () => {
    const options = {
      profile: flatProfile(1.3, 60, 10),
      durationMin: 60,
      seed: 42,
    };
    expect(generateOrders(params, options)).toEqual(
      generateOrders(params, options),
    );
    expect(generateOrders(params, { ...options, seed: 43 })).not.toEqual(
      generateOrders(params, options),
    );
  });

  test("offsets start at 0, increase, and stay within the duration", () => {
    const orders = generateOrders(params, {
      profile: flatProfile(1.3, 60, 10),
      durationMin: 60,
      seed: 1,
    });
    expect(orders[0].offsetSec).toBe(0);
    for (let i = 1; i < orders.length; i++) {
      expect(orders[i].offsetSec).toBeGreaterThan(orders[i - 1].offsetSec);
    }
    expect(orders[orders.length - 1].offsetSec).toBeLessThanOrEqual(3600);
  });

  test("the profile picks the stratum the gaps are drawn from", () => {
    // 最も暇な層（間隔 100〜120 秒）と最も混む層（20〜30 秒）
    const quiet = generateOrders(params, {
      profile: [0.5],
      durationMin: 60,
      seed: 1,
    });
    const busy = generateOrders(params, {
      profile: [1.3],
      durationMin: 60,
      seed: 1,
    });
    for (let i = 1; i < quiet.length; i++) {
      expect(
        quiet[i].offsetSec - quiet[i - 1].offsetSec,
      ).toBeGreaterThanOrEqual(100);
    }
    for (let i = 1; i < busy.length; i++) {
      expect(busy[i].offsetSec - busy[i - 1].offsetSec).toBeLessThanOrEqual(30);
    }
  });

  test("scaling never goes below the floor", () => {
    const floor = minGapSec(params);
    expect(floor).toBe(20);
    const orders = generateOrders(params, {
      profile: [1.3],
      durationMin: 60,
      seed: 7,
      scale: scaleOfLevel(4),
    });
    for (let i = 1; i < orders.length; i++) {
      expect(
        orders[i].offsetSec - orders[i - 1].offsetSec,
      ).toBeGreaterThanOrEqual(floor);
    }
  });

  test("baskets are drawn in proportion to their weight", () => {
    const drawn = sampleBaskets(params, mulberry32(3), 20000);
    const share =
      drawn.filter((b) => b.roles.house_blend === 1).length / drawn.length;
    expect(share).toBeGreaterThan(0.73);
    expect(share).toBeLessThan(0.77);
  });

  test("drinkCups counts cups but not goods", () => {
    const withGoods: GeneratorParams = {
      ...params,
      baskets: [{ roles: { ice_ore: 2, house_blend: 1 }, goods: 1, weight: 1 }],
    };
    const [first] = generateOrders(withGoods, {
      profile: [1.3],
      durationMin: 1,
      seed: 1,
    });
    expect(first.drinkCups).toBe(3);
    expect(first.goods).toBe(1);
  });
});

describe("[unit] rehearsal stop rule", () => {
  const model = FESTIVAL_STACK_MODEL;

  test("service time stays at c1 below the break point", () => {
    expect(serviceMin(model, 0)).toBe(model.c1);
    expect(serviceMin(model, model.a1)).toBeCloseTo(model.c1);
    expect(serviceMin(model, model.a1 + 10)).toBeCloseTo(
      model.c1 + 10 * model.slope,
    );
  });

  test("stops above 15 minutes and resumes below 13 minutes", () => {
    const stopAt = stackAt(model, STOP_MIN);
    const resumeAt = stackAt(model, RESUME_MIN);
    // 15 分は 24.7 杯、13 分は 20.4 杯
    expect(stopAt).toBeCloseTo(24.68, 1);
    expect(resumeAt).toBeCloseTo(20.4, 1);

    expect(shouldStop(model, 24, false)).toBe(false);
    expect(shouldStop(model, 25, false)).toBe(true);
    // 止めたあとは 13 分を下回るまで止めたまま
    expect(shouldStop(model, 22, true)).toBe(true);
    expect(shouldStop(model, 21, true)).toBe(true);
    expect(shouldStop(model, 20, true)).toBe(false);
  });
});
