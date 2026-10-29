import { type Order, OrderEntity } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import type { AnalysisOrder } from "./operations";
import {
  compareProductCups,
  comparisonChange,
  comparisonSettingsSchema,
  comparisonWindow,
  emptyComparisonSettings,
  historicalHourly,
} from "./yearComparison";

const at = (clock: string, date = "2026-10-30") =>
  Date.parse(`${date}T${clock}:00+09:00`);
const currentWindow = {
  start: at("10:15"),
  end: at("18:00"),
  now: at("12:30"),
};
const referenceWindow = comparisonWindow(currentWindow, "2025-11-02");
const historical = (
  id: string,
  product: string,
  clock = "11:00",
): AnalysisOrder => ({
  id,
  number: 1,
  created: at(clock, "2025-11-02"),
  cancelled: null,
  revenue: 500,
  comments: [],
  cups: [{ id, product, ready: null, served: null, orderTiming: true }],
});
const current = (
  id: string,
  productId: string,
  name = "今年の商品",
  fields: Partial<Order> = {},
) =>
  OrderEntity.fromOrder({
    ...OrderEntity.createNew({ orderId: 1 }).toOrder(),
    id,
    createdAt: new Date(at("11:00")),
    cups: [
      {
        id: `${id}:cup`,
        orderMenuId: "menu",
        item: {
          id: productId,
          name,
          abbr: "商",
          item_type: {
            name: "自由な区分",
            display_name: "自由",
            makes_cup: true,
            needs_brew: false,
            senior_only: false,
            iced_brew: false,
            serve_with_snack: false,
          },
        },
        readyAt: null,
        servedAt: null,
        dripper: null,
        dripperPosition: null,
        dripId: null,
        brewStartedAt: null,
        brewFinishedAt: null,
        emergencies: [],
      },
    ],
    ...fields,
  });
const productA = "00000000-0000-4000-8000-000000000001";
const productB = "00000000-0000-4000-8000-000000000002";

describe("unit year comparison", () => {
  test("前年も同じJST開始時刻から現在時刻までに切る", () => {
    expect(referenceWindow).toEqual({
      start: at("10:15", "2025-11-02"),
      end: at("12:30", "2025-11-02"),
      now: Number.POSITIVE_INFINITY,
    });
  });
  test("過去日は指定範囲全体、未来の終了は現在で切る", () => {
    expect(
      comparisonWindow({ ...currentWindow, now: at("23:00") }, "2025-11-03")
        .end,
    ).toBe(at("18:00", "2025-11-03"));
    expect(
      comparisonWindow({ ...currentWindow, now: at("09:00") }, "2025-11-03")
        .end,
    ).toBe(at("10:15", "2025-11-03"));
  });
  test("1時間未満の端数も同じ区間にし、終了時刻と取消は除く", () => {
    const cancelled = {
      ...historical("cancelled", "旧"),
      cancelled: at("12:00", "2025-11-02"),
    };
    const hourly = historicalHourly(
      [
        historical("before", "旧", "10:14"),
        historical("start", "旧", "10:15"),
        historical("partial", "旧", "12:29"),
        historical("end", "旧", "12:30"),
        cancelled,
      ],
      referenceWindow,
    );
    expect([...hourly]).toEqual([
      [10, 500],
      [12, 500],
    ]);
  });
  test("名前が違っても任意のグループで多対多に集計、取消と未対応は別にする", () => {
    const settings = {
      ...emptyComparisonSettings(),
      current: { [productA]: "定番", [productB]: "定番" },
      historical: { 旧A: "定番", 旧B: "定番" },
    };
    const result = compareProductCups(
      [
        current("a", productA),
        current("b", productB),
        current("renamed", productA, "名前変更後"),
        current("cancelled", productA, "取消", {
          cancelledAt: new Date(at("12:00")),
        }),
        current("end", productA, "終了", { createdAt: new Date(at("12:30")) }),
      ],
      [
        historical("oldA", "旧A"),
        historical("oldB", "旧B"),
        historical("unmapped", "未設定"),
      ],
      currentWindow,
      referenceWindow,
      settings,
      [productA, productB],
      ["旧A", "旧B", "未設定"],
    );
    expect(result.rows).toEqual([
      {
        name: "定番",
        current: 3,
        historical: 2,
        hasCurrent: true,
        hasHistorical: true,
      },
    ]);
    expect(result.unmappedHistorical).toBe(1);
  });
  test("対応変更を即反映し、未対応を推測しない", () => {
    const order = current("a", productA, "旧A");
    const old = historical("old", "旧A");
    const empty = compareProductCups(
      [order],
      [old],
      currentWindow,
      referenceWindow,
      emptyComparisonSettings(),
      [productA],
      ["旧A"],
    );
    expect(empty).toMatchObject({
      rows: [],
      unmappedCurrent: 1,
      unmappedHistorical: 1,
    });
    const settings = {
      ...emptyComparisonSettings(),
      current: { [productA]: "新グループ" },
      historical: { 旧A: "別グループ" },
    };
    const different = compareProductCups(
      [order],
      [old],
      currentWindow,
      referenceWindow,
      settings,
      [productA],
      ["旧A"],
    );
    expect(different.rows).toHaveLength(2);
    expect(
      different.rows.every((r) => !(r.hasCurrent && r.hasHistorical)),
    ).toBe(true);
  });
  test("対応済みで売上0と、片方の未対応を区別。消えた商品設定は集計しない", () => {
    const settings = {
      ...emptyComparisonSettings(),
      current: { [productA]: "ゼロ", removed: "古いグループ" },
      historical: { 旧: "ゼロ", removed: "古いグループ" },
    };
    const result = compareProductCups(
      [],
      [],
      currentWindow,
      referenceWindow,
      settings,
      [productA],
      ["旧"],
    );
    expect(result.rows).toEqual([
      {
        name: "ゼロ",
        current: 0,
        historical: 0,
        hasCurrent: true,
        hasHistorical: true,
      },
    ]);
    expect(result.chartRows).toEqual([
      { key: "group:ゼロ", name: "ゼロ", current: 0, previous: 0, members: [] },
    ]);
  });
  test("グラフも多対多を1行に合算し、未対応商品を重複なく残す", () => {
    const settings = {
      ...emptyComparisonSettings(),
      current: { [productA]: "まとめ" },
      historical: { 旧A: "まとめ", 旧B: "まとめ" },
    };
    const result = compareProductCups(
      [
        current("a", productA, "商品A"),
        current("b", productA, "商品A"),
        current("unmapped", productB, "商品B"),
      ],
      [historical("oldA", "旧A"), historical("oldB", "旧B")],
      currentWindow,
      referenceWindow,
      settings,
      [productA, productB],
      ["旧A", "旧B"],
    );
    expect(result.chartRows).toEqual([
      {
        key: "group:まとめ",
        name: "まとめ",
        current: 2,
        previous: 2,
        members: ["商品A"],
      },
      {
        key: `product:${productB}`,
        name: "商品B（未対応）",
        current: 1,
        previous: null,
        members: ["商品B"],
      },
    ]);
    expect(result.chartRows.reduce((sum, row) => sum + row.current, 0)).toBe(3);
    expect(
      result.chartRows.reduce((sum, row) => sum + (row.previous ?? 0), 0),
    ).toBe(2);
  });
  test("比率の分母が0のときにInfinityや100%を捏造しない", () => {
    expect(comparisonChange(500, 0, "円")).toBe(
      "+500円（前年0のため比率なし）",
    );
    expect(comparisonChange(750, 1000, "円")).toBe("−250円（-25.0%）");
  });
  test("localStorageの読み込み時に形式と版を検証", () => {
    expect(
      comparisonSettingsSchema.parse(
        JSON.parse(JSON.stringify(emptyComparisonSettings())),
      ),
    ).toEqual(emptyComparisonSettings());
    expect(comparisonSettingsSchema.safeParse({ version: 2 }).success).toBe(
      false,
    );
    expect(
      comparisonSettingsSchema.safeParse({
        ...emptyComparisonSettings(),
        current: { bad: 1 },
      }).success,
    ).toBe(false);
  });
});
