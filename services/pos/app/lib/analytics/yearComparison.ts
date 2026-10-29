import { type OrderEntity, jstClock, jstDate } from "@cafeore/common";
import { z } from "zod";
import type { AnalysisOrder, TimeWindow } from "./operations";

export const COMPARISON_STORAGE_KEY = "dashboard:2025-comparison:v1";
export const comparisonSettingsSchema = z.object({
  version: z.literal(1),
  referenceDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  current: z.record(z.string().max(80)),
  historical: z.record(z.string().max(80)),
});
export type ComparisonSettings = z.infer<typeof comparisonSettingsSchema>;
export const emptyComparisonSettings = (): ComparisonSettings => ({
  version: 1,
  referenceDate: "",
  current: {},
  historical: {},
});
export const currentProductKey = (item: { id?: string; name: string }) =>
  item.id || `name:${item.name}`;

export interface ProductComparisonChartRow {
  key: string;
  name: string;
  current: number;
  previous: number | null;
  members: string[];
}

/** 現在のJST時間帯と経過時間をそのまま比較日に移す。[start,end)で統一。 */
export function comparisonWindow(
  current: TimeWindow,
  referenceDate: string,
): TimeWindow {
  const midnight = Date.parse(`${jstDate(current.start)}T00:00:00+09:00`);
  const start =
    Date.parse(`${referenceDate}T00:00:00+09:00`) + current.start - midnight;
  return {
    start,
    end:
      start + Math.max(0, Math.min(current.end, current.now) - current.start),
    now: Number.POSITIVE_INFINITY,
  };
}

export function historicalHourly(
  orders: readonly AnalysisOrder[],
  window: TimeWindow,
) {
  const hourly = new Map<number, number>();
  for (const order of orders) {
    if (
      order.created < window.start ||
      order.created >= window.end ||
      (order.cancelled !== null && order.cancelled < window.end)
    )
      continue;
    const hour = Number(jstClock(order.created).slice(0, 2));
    hourly.set(hour, (hourly.get(hour) ?? 0) + order.revenue);
  }
  return hourly;
}

/** 分類は利用者が両年に付けたグループ名だけで決める。商品名から推測しない。 */
export function compareProductCups(
  current: readonly OrderEntity[],
  historical: readonly AnalysisOrder[],
  currentWindow: TimeWindow,
  referenceWindow: TimeWindow,
  settings: ComparisonSettings,
  currentKeys: readonly string[],
  historicalKeys: readonly string[],
) {
  const rows = new Map<
    string,
    {
      name: string;
      current: number;
      historical: number;
      hasCurrent: boolean;
      hasHistorical: boolean;
    }
  >();
  const row = (name: string) => {
    const existing = rows.get(name);
    if (existing) return existing;
    const created = {
      name,
      current: 0,
      historical: 0,
      hasCurrent: false,
      hasHistorical: false,
    };
    rows.set(name, created);
    return created;
  };
  for (const key of currentKeys) {
    const group = settings.current[key]?.trim();
    if (group) row(group).hasCurrent = true;
  }
  for (const key of historicalKeys) {
    const group = settings.historical[key]?.trim();
    if (group) row(group).hasHistorical = true;
  }
  let unmappedCurrent = 0;
  let unmappedHistorical = 0;
  const unmappedProducts = new Map<string, ProductComparisonChartRow>();
  const groupMembers = new Map<string, Set<string>>();
  const cutoff = Math.min(currentWindow.end, currentWindow.now);
  for (const order of current) {
    if (
      order.createdAt.getTime() < currentWindow.start ||
      order.createdAt.getTime() >= cutoff ||
      (order.cancelledAt !== null && order.cancelledAt.getTime() < cutoff)
    )
      continue;
    for (const cup of order.cups) {
      const group = settings.current[currentProductKey(cup.item)]?.trim();
      if (group) {
        const target = row(group);
        target.hasCurrent = true;
        target.current++;
        const members = groupMembers.get(group) ?? new Set<string>();
        members.add(cup.item.name);
        groupMembers.set(group, members);
      } else {
        unmappedCurrent++;
        const key = currentProductKey(cup.item);
        const product = unmappedProducts.get(key) ?? {
          key: `product:${key}`,
          name: `${cup.item.name}（未対応）`,
          current: 0,
          previous: null,
          members: [cup.item.name],
        };
        product.current++;
        unmappedProducts.set(key, product);
      }
    }
  }
  for (const order of historical) {
    if (
      order.created < referenceWindow.start ||
      order.created >= referenceWindow.end ||
      (order.cancelled !== null && order.cancelled < referenceWindow.end)
    )
      continue;
    for (const cup of order.cups) {
      const group = settings.historical[cup.product]?.trim();
      if (group) {
        const target = row(group);
        target.hasHistorical = true;
        target.historical++;
      } else unmappedHistorical++;
    }
  }
  return {
    rows: [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "ja")),
    unmappedCurrent,
    unmappedHistorical,
    // 多対多の前年合計を各商品へ重複表示しない。対応済みはグループを1行にする。
    chartRows: [
      ...[...rows.values()]
        .filter((r) => r.hasCurrent)
        .map(
          (r): ProductComparisonChartRow => ({
            key: `group:${r.name}`,
            name: r.name,
            current: r.current,
            previous: r.hasHistorical ? r.historical : null,
            members: [...(groupMembers.get(r.name) ?? [])].sort(),
          }),
        ),
      ...unmappedProducts.values(),
    ].sort(
      (a, b) => b.current - a.current || a.name.localeCompare(b.name, "ja"),
    ),
  };
}

export function comparisonChange(
  current: number,
  reference: number,
  unit: "円" | "杯",
) {
  const difference = current - reference;
  const amount = `${difference > 0 ? "+" : difference < 0 ? "−" : "±"}${Math.abs(difference).toLocaleString("ja-JP")}${unit}`;
  const percent =
    reference > 0
      ? `（${difference > 0 ? "+" : ""}${((difference / reference) * 100).toFixed(1)}%）`
      : "（前年0のため比率なし）";
  return `${amount}${percent}`;
}
