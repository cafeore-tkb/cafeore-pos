import type { OrderEntity } from "@cafeore/common";

export const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("ja");
export const orderRecordStatus = (order: OrderEntity) =>
  order.isCancelled()
    ? "キャンセル"
    : order.servedAt
      ? "提供済み"
      : order.readyAt
        ? "お渡し待ち"
        : "準備中";

export const filterOrderRecords = <T extends OrderEntity>(
  orders: readonly T[],
  query: string,
  status: string,
) => {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return orders
    .filter((order) => {
      if (status !== "すべて" && orderRecordStatus(order) !== status)
        return false;
      const text = normalize(
        [
          `#${order.orderId}`,
          `#${String(order.orderId).padStart(3, "0")}`,
          order.id,
          ...order.menus.flatMap((menu) => [
            menu.name,
            menu.assignee ?? "",
            menu.dripper ? `${menu.dripper}番` : "",
          ]),
          ...order.getItems().map((item) => item.name),
          ...order.comments.map((comment) => comment.text),
        ].join(" "),
      );
      return words.every((word) => text.includes(word));
    })
    .sort(
      (a, b) =>
        b.createdAt.getTime() - a.createdAt.getTime() || b.orderId - a.orderId,
    );
};

export const orderRecordPage = <T>(
  records: readonly T[],
  requested: number,
) => {
  const size = 30;
  const lastPage = Math.max(0, Math.ceil(records.length / size) - 1);
  const shownPage = Math.max(0, Math.min(Math.trunc(requested), lastPage));
  return {
    lastPage,
    shownPage,
    shown: records.slice(shownPage * size, (shownPage + 1) * size),
  };
};

/** 個別会計では実際の支払い内訳を優先する。旧記録の返金時刻・状態も取りこぼさない。 */
export const refundSections = (order: OrderEntity) => ({
  cash:
    Boolean(order.cashRefundedAt) ||
    (order.payments.length
      ? order.payments.some((p) => p.method === "cash")
      : order.paymentMethod === "cash"),
  square:
    (order.squareRefundStatus !== undefined &&
      order.squareRefundStatus !== "none") ||
    (order.payments.length
      ? order.payments.some((p) => p.method === "square")
      : order.paymentMethod === "square"),
});

/** 注文全体の受付から提供完了まで。未提供・不正な時刻は未計測。 */
export const orderServiceTime = (order: OrderEntity) => {
  if (!order.servedAt) return { label: "—", overdue: false };
  const ms = order.servedAt.getTime() - order.createdAt.getTime();
  if (!Number.isFinite(ms) || ms < 0) return { label: "—", overdue: false };
  const seconds = Math.floor(ms / 1000);
  return {
    label: `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`,
    overdue: ms > 15 * 60000,
  };
};
