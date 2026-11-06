import type { InventoryStatus, OrderEntity } from "@cafeore/common";
import { z } from "zod";
import paramsJson from "./data/stockout-params-2026.json";
import { type CupDistribution, nb2 } from "./nb2";

/**
 * 閉店までの残り杯数の分布と、在庫が切れる確率（sohosai-analysis T-92 の案 A を画面に載せたもの。T-93）。
 *
 * - 残り杯数 R ~ NB2(μ, α)。μ は t までの杯数 n があればそのペースの延長 n / E_t × E_rem、まだ 0 杯なら
 *   過去の祭のペース r̄ × E_rem。α と r̄ は 2024・2025 年祭の 4 日で当てた値で、画面では当て直さない
 * - 数えるのは受付杯数（スループット）で、需要ではない
 * - 残りの在庫は在庫 API の残量から、API がまだ引いていない受付済みの杯を引いたもの（stockLeft）。淹れ直しは考えない
 */

const unitSchema = z.object({
  key: z.string(),
  train_unit: z.string(),
  stock: z.enum(["item", "cup", "none"]),
  items: z.array(z.string()),
  item_types: z.array(z.string()),
  r_bar: z.number().positive(),
  alpha: z.number().nonnegative(),
  train_days: z.array(z.string()),
  n_times: z.number().int(),
});
const paramsSchema = z.object({
  source: z.string(),
  commit: z.string(),
  sha256: z.string(),
  schema_version: z.literal(1),
  poisson_alpha: z.number(),
  fit_times: z.object({
    from_open_min: z.number(),
    until_before_close_min: z.number(),
  }),
  quantiles: z.array(z.number()),
  units: z.array(unitSchema).min(1),
  hidden_units: z.array(z.string()),
  item_roles: z.array(z.object({ item_name: z.string(), role: z.string() })),
});
export type StockoutUnit = z.infer<typeof unitSchema>;
export type StockoutParams = z.infer<typeof paramsSchema>;
export const stockoutParams: StockoutParams = paramsSchema.parse(paramsJson);

export interface ForecastCup {
  itemId: string | null;
  itemName: string;
  itemType: string;
  needsBrew: boolean;
  ready: number | null;
  served: number | null;
}
export interface ForecastOrder {
  created: number;
  cancelled: number | null;
  cups: ForecastCup[];
}
const time = (date: Date | null | undefined) => {
  const value = date?.getTime();
  return value !== undefined && Number.isFinite(value) ? value : null;
};
export const forecastOrders = (
  orders: readonly OrderEntity[],
): ForecastOrder[] =>
  orders.map((order) => ({
    created: order.createdAt.getTime(),
    cancelled: time(order.cancelledAt),
    cups: order.cups.map((cup) => ({
      itemId: cup.item.id ?? null,
      itemName: cup.item.name,
      itemType: cup.item.item_type.name,
      needsBrew: cup.item.item_type.makes_cup && cup.item.item_type.needs_brew,
      ready: time(cup.readyAt),
      served: time(cup.servedAt),
    })),
  }));

const MINUTE = 60_000;

/** 案 A の平均。n > 0 なら n / E_t × E_rem、0 杯なら r̄ × E_rem（分・杯/分。sohosai-analysis の case_a_mean() と同じ） */
export const caseAMean = (
  n: number,
  elapsedMin: number,
  remainingMin: number,
  rBar: number,
) => (n > 0 ? (elapsedMin > 0 ? n / elapsedMin : 0) : rBar) * remainingMin;

const inUnit = (unit: StockoutUnit, cup: ForecastCup) =>
  unit.stock === "item"
    ? unit.items.includes(cup.itemName)
    : unit.stock === "cup"
      ? unit.item_types.includes(cup.itemType)
      : true;

/**
 * t までの杯数。開店から t までに受け付けた杯で、t までに分かった「提供可能になる前の取消」の杯は数えない（T-92 判断 5）
 */
export function unitCups(
  unit: StockoutUnit,
  orders: readonly ForecastOrder[],
  open: number,
  t: number,
) {
  let n = 0;
  for (const order of orders) {
    if (order.created < open || order.created > t) continue;
    const cancelled = order.cancelled !== null && order.cancelled <= t;
    for (const cup of order.cups) {
      if (!inUnit(unit, cup)) continue;
      if (
        cancelled &&
        !(cup.ready !== null && cup.ready <= (order.cancelled as number))
      )
        continue;
      n++;
    }
  }
  return n;
}

export interface DayHours {
  open: number;
  close: number;
}
export interface UnitForecast {
  n: number;
  elapsedMin: number;
  remainingMin: number;
  mu: number;
  distribution: CupDistribution;
}
export function unitForecast(
  unit: StockoutUnit,
  orders: readonly ForecastOrder[],
  hours: DayHours,
  t: number,
  params: StockoutParams = stockoutParams,
): UnitForecast {
  if (t < hours.open || t > hours.close)
    throw new Error("時点が開店〜閉店の外です");
  const n = unitCups(unit, orders, hours.open, t);
  const elapsedMin = (t - hours.open) / MINUTE;
  const remainingMin = (hours.close - t) / MINUTE;
  const mu = caseAMean(n, elapsedMin, remainingMin, unit.r_bar);
  return {
    n,
    elapsedMin,
    remainingMin,
    mu,
    distribution: nb2(mu, unit.alpha, params.poisson_alpha),
  };
}

/** 在庫の資源とその杯の対応（在庫 API と同じ。品目の在庫は品目、カップは使う種類） */
const usesResource = (
  status: InventoryStatus,
  cup: ForecastCup,
  typeNames: ReadonlySet<string>,
) =>
  status.resource.kind === "item"
    ? cup.itemId !== null && cup.itemId === status.resource.item_id
    : typeNames.has(cup.itemType);

/**
 * 在庫 API が tau の時点でまだ引いていない、now までに受け付けた杯の数。
 * API の数え方（GET /api/inventory）：抽出の要る杯は 提供可能 → 提供済み → 取消 の時刻の早いもの（COALESCE）、
 * 抽出の要らない杯は受付の時刻で引く。取り消しても在庫は戻さない。淹れ直しは考えない（T-93 判断 2）
 */
export function pendingServings(
  status: InventoryStatus,
  orders: readonly ForecastOrder[],
  typeNames: ReadonlySet<string>,
  tau: number,
  now: number,
) {
  let pending = 0;
  for (const order of orders) {
    if (order.created > now) continue;
    for (const cup of order.cups) {
      if (!usesResource(status, cup, typeNames)) continue;
      const used = cup.needsBrew
        ? (cup.ready ?? cup.served ?? order.cancelled)
        : order.created;
      if (used === null || used > tau) pending++;
    }
  }
  return pending;
}

export type ResourceMatch =
  | { status: InventoryStatus; typeNames: ReadonlySet<string> }
  | { reason: string };

/** 単位の在庫の資源。品目は品名、カップは使う種類の集合が HOT・ICE とちょうど一致するものだけ */
export function resourceForUnit(
  unit: StockoutUnit,
  statuses: readonly InventoryStatus[],
  itemTypeNames: ReadonlyMap<string, string>,
): ResourceMatch {
  if (unit.stock === "none") return { reason: "在庫の対象が無い（分布だけ）" };
  const typesOf = (status: InventoryStatus) =>
    new Set(
      status.resource.item_type_ids.map((id) => itemTypeNames.get(id) ?? id),
    );
  const matches = statuses.filter((status) => {
    if (status.resource.kind !== unit.stock) return false;
    if (unit.stock === "item") return unit.items.includes(status.resource.name);
    const types = typesOf(status);
    return (
      types.size === unit.item_types.length &&
      unit.item_types.every((type) => types.has(type))
    );
  });
  if (matches.length === 0)
    return {
      reason:
        unit.stock === "item"
          ? "在庫に登録されていない"
          : "使う種類がちょうど一致するカップが無い",
    };
  if (matches.length > 1) return { reason: "当てはまる在庫が複数ある" };
  const status = matches[0];
  if (status.remaining_servings == null || status.level === "untracked")
    return { reason: "棚卸しが無い（残量が未計測）" };
  return { status, typeNames: typesOf(status) };
}

export interface StockoutRow {
  unit: StockoutUnit;
  forecast: UnitForecast;
  quantiles: { q: number; value: number }[];
  resource: string | null;
  stockLeft: number | null;
  pStockout: number | null;
  alreadyOut: boolean | null;
  reason: string | null;
}
export interface StockoutInput {
  orders: readonly ForecastOrder[];
  statuses: readonly InventoryStatus[];
  itemTypeNames: ReadonlyMap<string, string>;
  /** 在庫を取った時刻 */
  tau: number;
  hours: DayHours;
  t: number;
}

export function stockoutRows(
  input: StockoutInput,
  params: StockoutParams = stockoutParams,
): StockoutRow[] {
  return params.units.map((unit) => {
    const forecast = unitForecast(
      unit,
      input.orders,
      input.hours,
      input.t,
      params,
    );
    const quantiles = params.quantiles.map((q) => ({
      q,
      value: forecast.distribution.quantile(q),
    }));
    const match = resourceForUnit(unit, input.statuses, input.itemTypeNames);
    if ("reason" in match)
      return {
        unit,
        forecast,
        quantiles,
        resource: null,
        stockLeft: null,
        pStockout: null,
        alreadyOut: null,
        reason: match.reason,
      };
    const stockLeft =
      (match.status.remaining_servings as number) -
      pendingServings(
        match.status,
        input.orders,
        match.typeNames,
        input.tau,
        input.t,
      );
    return {
      unit,
      forecast,
      quantiles,
      resource: match.status.resource.name,
      stockLeft,
      pStockout: forecast.distribution.exceedance(stockLeft),
      alreadyOut: stockLeft <= 0,
      reason: null,
    };
  });
}

/** 表に無い品名（その杯の単位は分からないので、どの品目の単位にも入れない） */
export function unknownItems(
  orders: readonly ForecastOrder[],
  params: StockoutParams = stockoutParams,
) {
  const known = new Set(params.item_roles.map((r) => r.item_name));
  return [
    ...new Set(
      orders.flatMap((o) =>
        o.cups.map((c) => c.itemName).filter((name) => !known.has(name)),
      ),
    ),
  ].sort();
}

/** t が α を当てた時点の範囲（開店の 30 分後〜閉店の 10 分前）の外か */
export const outsideFitTimes = (
  hours: DayHours,
  t: number,
  params: StockoutParams = stockoutParams,
) =>
  t < hours.open + params.fit_times.from_open_min * MINUTE ||
  t > hours.close - params.fit_times.until_before_close_min * MINUTE;
