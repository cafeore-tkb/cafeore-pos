import { toPracticeOrder } from "@cafeore/common";
import { z } from "zod";
import type { AnalysisOrder } from "./operations";

const legacyOrderSchema = z.object({
  orderId: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  readyAt: z.string().datetime({ offset: true }).nullable().optional(),
  servedAt: z.string().datetime({ offset: true }).nullable().optional(),
  billingAmount: z.number().finite().nonnegative(),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.enum(["hot", "ice", "iceOre", "milk", "others"]),
      }),
    )
    .min(1),
});

/** 過去の注文単位のready/servedを各杯に展開。杯ごとの実打刻と混同しない。 */
export const historicalOrders = (input: unknown): AnalysisOrder[] => {
  const rows = Array.isArray(input)
    ? input
    : typeof input === "object" && input !== null && "orders" in input
      ? input.orders
      : null;
  if (!Array.isArray(rows))
    throw new Error("orders配列を含む注文JSONを選んでください。");
  const orders = rows.map((row, index) => {
    const checked = legacyOrderSchema.safeParse(row);
    if (!checked.success)
      throw new Error(
        `${index + 1}行目の注文番号・日時・請求額・商品種別を確認してください。欠損を0で補完しません。`,
      );
    const value = toPracticeOrder(checked.data);
    if (!value || !value.items.length || !value.orderId)
      throw new Error(`${index + 1}行目の注文を読み取れません。`);
    const created = Date.parse(value.createdAt);
    if (new Date(created + 9 * 3_600_000).getUTCFullYear() !== 2025)
      throw new Error("比較用には2025年の注文データを選んでください。");
    return {
      id: `2025:${value.createdAt}:${value.orderId}`,
      number: value.orderId,
      created,
      cancelled: null,
      revenue: value.billingAmount,
      comments: [],
      cups: value.items
        .filter(
          (item) =>
            item.itemType?.makes_cup ??
            ["hot", "ice", "iceOre", "milk"].includes(item.type),
        )
        .map((item, index) => ({
          id: `${value.orderId}:${index}`,
          product: item.name,
          ready: value.readyAt ? Date.parse(value.readyAt) : null,
          served: value.servedAt ? Date.parse(value.servedAt) : null,
          orderTiming: true,
        })),
    } satisfies AnalysisOrder;
  });
  return [...new Map(orders.map((o) => [o.id, o])).values()];
};

export const load2025Baseline = async () => {
  const { default: data } = await import("./data/baseline-2025.json");
  const orders = historicalOrders({
    orders: data.orders.map((row) => ({
      orderId: row[0],
      createdAt: row[1],
      readyAt: row[2],
      servedAt: row[3],
      billingAmount: row[4],
      items: (row[5] as string[][]).map(([name, type]) => ({ name, type })),
    })),
  });
  return {
    orders,
    source: data.source,
    commit: data.commit,
    sha256: data.sha256,
  };
};
