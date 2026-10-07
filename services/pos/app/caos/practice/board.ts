import type { CaosPracticeState } from "@cafeore/common";
import type { Catalog } from "../live/drips";
import type { SalesOrder } from "../types";

// 練習用の盤面（サーバーの CaosPracticeState）を、本番の盤面と同じ組み立て（live/drips.ts の dripsToBoard）に渡す形にする。
// 名前・種類はサーバーが返した練習の商品をそのまま使う（対応表で呼び方をそろえない）。

/** 練習の注文と商品から、カードの注文番号・商品名を引くカタログ */
export const practiceCatalog = (state: CaosPracticeState | null): Catalog => {
  const catalog: Catalog = new Map();
  if (!state) return catalog;
  const items = new Map(
    state.items.map((item) => [
      item.id,
      { id: item.id, name: item.name, abbr: item.name, type: item.type },
    ]),
  );
  for (const order of state.orders) {
    catalog.set(order.id, { orderNo: order.order_no, items });
  }
  return catalog;
};

/** 実績（売上・注文→完成）に出す注文。準備完了は練習の中で付いた時刻 */
export const practiceSalesOrders = (
  state: CaosPracticeState | null,
): SalesOrder[] => {
  if (!state) return [];
  const items = new Map(state.items.map((item) => [item.id, item]));
  return state.orders.map((order) => ({
    orderId: order.order_no,
    createdAt: order.created_at,
    readyAt: order.ready_at,
    billingAmount: order.billing_amount,
    items: order.lines.flatMap((line) => {
      const item = items.get(line.item_id);
      return Array.from({ length: line.quantity }, () => ({
        name: item?.name ?? "（不明）",
        price: line.price,
        type: item?.type ?? "",
      }));
    }),
  }));
};
