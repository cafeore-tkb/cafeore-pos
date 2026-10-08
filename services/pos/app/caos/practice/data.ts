import type {
  CaosPracticeOrderInput,
  PracticeDataOrder,
} from "@cafeore/common";

// 実データテストのデータ（利用者が画面で読み込んだ注文。正規化は @cafeore/common の caosPracticeData）。
// ここは時間帯で切り出すのと、練習用の盤面に送る形にするところ。

export type { PracticeDataItem, PracticeDataOrder } from "@cafeore/common";

const createdMs = (order: PracticeDataOrder) =>
  new Date(order.createdAt).getTime();

/** 時間帯 [startMs, endMs) の注文（作った順） */
export const ordersInWindow = (
  orders: PracticeDataOrder[],
  startMs: number,
  endMs: number,
) =>
  orders
    .filter((order) => createdMs(order) >= startMs && createdMs(order) < endMs)
    .sort((a, b) => createdMs(a) - createdMs(b));

/**
 * 実データの注文を、練習用の盤面に送る形にする。同じ商品（ID、無ければ名前）は 1 行にまとめて杯数にする。
 * どれを抽出するか・何杯ずつのカードにするかはサーバーの盤面のルールで決まる（ここでは分けない）
 */
export const toPracticeOrderInput = (
  order: PracticeDataOrder,
): CaosPracticeOrderInput => {
  const lines = new Map<string, CaosPracticeOrderInput["lines"][number]>();
  for (const item of order.items) {
    const key = item.id || item.name;
    const line = lines.get(key);
    if (line) {
      line.quantity += 1;
      continue;
    }
    lines.set(key, {
      item_key: key,
      name: item.name,
      type: item.type,
      price: item.price,
      quantity: 1,
    });
  }
  return {
    order_no: order.orderId,
    created_at: order.createdAt,
    billing_amount: order.billingAmount,
    lines: Array.from(lines.values()),
  };
};
