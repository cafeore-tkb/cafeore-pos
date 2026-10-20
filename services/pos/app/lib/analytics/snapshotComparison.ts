import { OrderEntity, orderSchema } from "@cafeore/common";
import { historicalOrders } from "./historical";
import { liveAnalysisOrders } from "./operations";

const DATE_KEYS = new Set([
  "createdAt",
  "readyAt",
  "servedAt",
  "cancelledAt",
  "cashRefundedAt",
  "brewStartedAt",
  "brewFinishedAt",
]);
/** 旧ダッシュボードで使っていた {orders: Order[]} と2025形式を端末内で読む。 */
export function snapshotAnalysisOrders(text: string) {
  const input: unknown = JSON.parse(text);
  const rows = Array.isArray(input)
    ? input
    : input && typeof input === "object" && "orders" in input
      ? input.orders
      : null;
  if (!Array.isArray(rows) || !rows.length)
    throw new Error("注文を含むorders配列のJSONを選んでください。");
  if (
    rows.every(
      (row) =>
        row && typeof row === "object" && "items" in row && !("menus" in row),
    )
  )
    return historicalOrders(input);
  const revived = JSON.parse(JSON.stringify(rows), (key, value) =>
    DATE_KEYS.has(key) && typeof value === "string" ? new Date(value) : value,
  ) as unknown[];
  const snapshots = revived.map((row, index) => {
    const checked = orderSchema.safeParse(row);
    if (!checked.success)
      throw new Error(
        `${index + 1}行目の注文形式・日時を確認してください。欠損値は補完しません。`,
      );
    return checked.data;
  });
  const entities = snapshots.map((o, index) =>
    OrderEntity.fromOrder({
      ...o,
      id: o.id ?? `snapshot:${index}:${o.orderId}`,
    }),
  );
  return liveAnalysisOrders(entities).map((result, index) => {
    const analysis = { ...result, revenue: snapshots[index].billingAmount };
    const entity = entities[index];
    if (entity.cups.length) return analysis;
    // 古いスナップショットは杯別打刻がない。構成数量から展開し注文打刻由来と明記する。
    return {
      ...analysis,
      cups: entity.getDrinkCups().map((item, i) => ({
        id: `${analysis.id}:legacy:${i}`,
        product: item.name,
        ready: entity.readyAt?.getTime() ?? null,
        served: entity.servedAt?.getTime() ?? null,
        orderTiming: true,
      })),
    };
  });
}
