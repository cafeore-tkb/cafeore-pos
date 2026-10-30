import type { InventoryStatus } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import checks from "./data/stockout-checks-2026.json";
import { nb2 } from "./nb2";
import {
  type ForecastCup,
  type ForecastOrder,
  caseAMean,
  outsideFitTimes,
  pendingServings,
  resourceForUnit,
  stockoutParams,
  stockoutRows,
  unitCups,
  unitForecast,
  unknownItems,
} from "./stockoutForecast";

const at = (clock: string) => Date.parse(`2026-11-07T${clock}:00+09:00`);
const unit = (key: string) => {
  const found = stockoutParams.units.find((u) => u.key === key);
  if (!found) throw new Error(key);
  return found;
};
const cup = (over: Partial<ForecastCup> = {}): ForecastCup => ({
  itemId: "item-yoin",
  itemName: "余音ブレンド",
  itemType: "blend",
  needsBrew: true,
  ready: null,
  served: null,
  ...over,
});
const order = (
  created: string,
  cups: ForecastCup[],
  cancelled: string | null = null,
): ForecastOrder => ({
  created: at(created),
  cancelled: cancelled ? at(cancelled) : null,
  cups,
});
const status = (
  over: Partial<InventoryStatus["resource"]>,
  remaining: number | null = 100,
): InventoryStatus => ({
  resource: {
    id: "r",
    kind: "item",
    item_id: "item-yoin",
    name: "余音ブレンド",
    item_type_ids: [],
    unit: "g",
    per_serving: 15,
    notify_from: 0,
    notify_step: 0,
    buffer: 0,
    ...over,
  },
  level: remaining === null ? "untracked" : "ok",
  received: 0,
  consumed: 0,
  servings: 0,
  remaining_servings: remaining,
  servings_last_hour: 0,
});
const typeNames = new Map([
  ["t-blend", "blend"],
  ["t-gourmet", "gourmet"],
  ["t-limited", "limited"],
  ["t-ice", "ice"],
  ["t-iceOre", "iceOre"],
  ["t-milk", "milk"],
]);

describe("unit stockout forecast", () => {
  test("同梱した当てた値は gourmet・limited を出さない 8 単位", () => {
    expect(stockoutParams.units.map((u) => u.key)).toEqual([
      "signature_blend",
      "house_blend",
      "ice",
      "iceOre",
      "milk",
      "HOT",
      "ICE",
      "total",
    ]);
    expect(stockoutParams.hidden_units).toEqual(["gourmet", "limited"]);
  });

  test("平均と分位点が sohosai-analysis の案 A の正解と一致する", () => {
    for (const c of checks.forecast) {
      const u = unit(c.unit);
      const mu = caseAMean(c.n, c.elapsed_min, c.remaining_min, u.r_bar);
      expect(mu).toBeCloseTo(c.mu, 10);
      expect(u.alpha).toBe(c.alpha);
      const d = nb2(mu, u.alpha, stockoutParams.poisson_alpha);
      for (const [q, v] of Object.entries(c.quantiles))
        expect(d.quantile(Number(q))).toBe(v);
    }
  });

  test("t までの杯数: 開店前・t より後・提供前の取消を数えず、単位は品名・種類で分ける", () => {
    const orders = [
      order("09:50", [cup()]), // 開店前
      order("10:05", [cup(), cup({ itemName: "ケニア", itemType: "gourmet" })]),
      order("10:10", [cup()], "10:20"), // 提供前に取消
      order("10:12", [cup({ ready: at("10:15") })], "10:25"), // 提供可能の後に取消
      order("10:14", [cup()], "10:40"), // t より後の取消
      order("10:31", [cup()]), // t より後
    ];
    const t = at("10:30");
    expect(unitCups(unit("signature_blend"), orders, at("10:00"), t)).toBe(3);
    expect(unitCups(unit("HOT"), orders, at("10:00"), t)).toBe(4);
    expect(unitCups(unit("total"), orders, at("10:00"), t)).toBe(4);
    expect(unitCups(unit("ICE"), orders, at("10:00"), t)).toBe(0);
  });

  test("t より後の注文・取消・提供を書き換えても予測は変わらない", () => {
    const hours = { open: at("10:00"), close: at("17:00") };
    const t = at("12:00");
    const base = [order("10:30", [cup()]), order("11:30", [cup(), cup()])];
    const later = [
      ...base.map((o) => ({ ...o, cancelled: at("12:30") })),
      order("12:10", [cup(), cup(), cup()]),
    ];
    const a = unitForecast(unit("signature_blend"), base, hours, t);
    const b = unitForecast(unit("signature_blend"), later, hours, t);
    expect(b.n).toBe(a.n);
    expect(b.mu).toBe(a.mu);
    expect(a.mu).toBeCloseTo((3 / 120) * 300, 10);
  });

  test("0 杯のあいだは過去の祭のペース、閉店では 0 杯の 1 点", () => {
    const hours = { open: at("10:00"), close: at("17:00") };
    const u = unit("milk");
    const zero = unitForecast(u, [], hours, at("10:20"));
    expect(zero.mu).toBeCloseTo(u.r_bar * 400, 10);
    const closed = unitForecast(u, [], hours, at("17:00"));
    expect(closed.distribution.exceedance(0)).toBe(0);
    expect(() => unitForecast(u, [], hours, at("17:01"))).toThrow();
  });

  test("在庫 API がまだ引いていない杯: 抽出の要る杯は 提供可能→提供済み→取消、要らない杯は受付で引く", () => {
    const tau = at("12:00");
    const now = at("12:05");
    const yoin = status({});
    const orders = [
      order("11:00", [cup({ ready: at("11:30") })]), // tau 前に提供可能 → 引き済み
      order("11:10", [cup({ ready: at("12:02") })]), // tau 後に提供可能 → まだ
      order("11:20", [cup({ served: at("11:50") })]), // 提供済みの時刻で引き済み
      order("11:30", [cup()]), // 待ち → まだ
      order("11:40", [cup()], "11:45"), // tau 前に取消 → 取消で引き済み（在庫は戻さない）
      order("11:41", [cup()], "12:03"), // tau 後に取消 → まだ
      order("12:04", [cup()]), // tau 後の受付 → まだ
      order("12:06", [cup()]), // now より後 → 数えない
      order("11:42", [cup({ itemId: "other", itemName: "珈琲・俺ブレンド" })]),
    ];
    expect(pendingServings(yoin, orders, new Set(), tau, now)).toBe(4);
    const milkCup = cup({
      itemId: "item-milk",
      itemName: "アイスミルク",
      itemType: "milk",
      needsBrew: false,
    });
    const milk = status({ item_id: "item-milk", name: "アイスミルク" });
    const milkOrders = [order("11:59", [milkCup]), order("12:01", [milkCup])];
    expect(pendingServings(milk, milkOrders, new Set(), tau, now)).toBe(1);
    const iceCup = status({
      kind: "cup",
      item_id: null,
      name: "アイスカップ",
      item_type_ids: ["t-ice", "t-iceOre", "t-milk"],
    });
    expect(
      pendingServings(
        iceCup,
        milkOrders,
        new Set(["ice", "iceOre", "milk"]),
        tau,
        now,
      ),
    ).toBe(1);
  });

  test("在庫の資源: 品目は品名、カップは種類の集合がちょうど一致するときだけ", () => {
    const hot = status({
      kind: "cup",
      item_id: null,
      name: "ホットカップ",
      item_type_ids: ["t-blend", "t-gourmet", "t-limited"],
    });
    const wide = status({
      kind: "cup",
      item_id: null,
      name: "共用カップ",
      item_type_ids: ["t-ice", "t-iceOre", "t-milk", "t-blend"],
    });
    const statuses = [status({}), hot, wide];
    const sig = resourceForUnit(unit("signature_blend"), statuses, typeNames);
    expect("status" in sig && sig.status.resource.name).toBe("余音ブレンド");
    const h = resourceForUnit(unit("HOT"), statuses, typeNames);
    expect("status" in h && h.status.resource.name).toBe("ホットカップ");
    expect(resourceForUnit(unit("ICE"), statuses, typeNames)).toEqual({
      reason: "使う種類がちょうど一致するカップが無い",
    });
    expect(resourceForUnit(unit("total"), statuses, typeNames)).toHaveProperty(
      "reason",
    );
    expect(resourceForUnit(unit("house_blend"), statuses, typeNames)).toEqual({
      reason: "在庫に登録されていない",
    });
    expect(
      resourceForUnit(unit("signature_blend"), [status({}, null)], typeNames),
    ).toEqual({ reason: "棚卸しが無い（残量が未計測）" });
  });

  test("在庫が切れる確率は残りの在庫の超過確率、残り 0 以下はすでに切れている", () => {
    const hours = { open: at("10:00"), close: at("17:00") };
    const orders = [order("10:30", [cup()]), order("11:00", [cup()])];
    const input = {
      orders,
      itemTypeNames: typeNames,
      tau: at("12:00"),
      hours,
      t: at("12:00"),
    };
    const [row] = stockoutRows({ ...input, statuses: [status({}, 10)] });
    expect(row.stockLeft).toBe(8);
    expect(row.pStockout).toBe(row.forecast.distribution.exceedance(8));
    expect(row.alreadyOut).toBe(false);
    const [out] = stockoutRows({ ...input, statuses: [status({}, 2)] });
    expect(out.stockLeft).toBe(0);
    expect(out.alreadyOut).toBe(true);
    const rows = stockoutRows({ ...input, statuses: [] });
    expect(rows.every((r) => r.pStockout === null && r.reason)).toBe(true);
  });

  test("表に無い品名を拾い、α を当てた時点の範囲の外を示す", () => {
    expect(
      unknownItems([
        order("10:00", [cup(), cup({ itemName: "新しい豆" })]),
        order("10:01", [cup({ itemName: "新しい豆" })]),
      ]),
    ).toEqual(["新しい豆"]);
    const hours = { open: at("10:00"), close: at("17:00") };
    expect(outsideFitTimes(hours, at("10:29"))).toBe(true);
    expect(outsideFitTimes(hours, at("10:30"))).toBe(false);
    expect(outsideFitTimes(hours, at("16:51"))).toBe(true);
  });
});
