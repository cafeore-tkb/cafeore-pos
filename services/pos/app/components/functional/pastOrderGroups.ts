import { OrderEntity, type WithId } from "@cafeore/common";

/**
 * レジの「過去の注文」で、分割して一括会計で分けた注文（分割グループ）を 1 つの注文として出す
 *
 * 1 つ目の注文が支払いを全部持ち、2 つ目以降は splitParentId で 1 つ目を指す。返金・キャンセルは 1 つ目の注文を
 * 指定すればサーバーがグループをまとめて扱うので、画面では 1 つ目の注文の ID のまま、商品・杯・金額をまとめた注文を出す。
 */

/** 過去の注文の 1 件（分けていなければ注文 1 つ） */
export type PastOrderGroup = {
  /** 1 つ目の注文と、分けた注文（番号の順） */
  orders: WithId<OrderEntity>[];
  /** 注文番号（1 つ目、続けて分けた注文） */
  orderIds: number[];
  /**
   * 画面に出す注文。分けていなければ 1 つ目の注文そのもの。分けていれば、1 つ目の注文に分けた注文の商品・カップ・
   * コメントを足し、割引は引いた額の合計、提供の状態は全部の注文がそろったときだけ進める
   */
  order: WithId<OrderEntity>;
};

const latest = (dates: (Date | null)[]) =>
  dates.some((date) => date === null)
    ? null
    : new Date(Math.max(...dates.map((date) => date?.getTime() ?? 0)));

/** 分割グループの注文をまとめた注文（1 つ目の注文の ID・支払い・キャンセル・返金の状態のまま） */
const combineOrders = (
  first: WithId<OrderEntity>,
  splits: readonly WithId<OrderEntity>[],
): WithId<OrderEntity> => {
  const orders = [first, ...splits];
  const comments = orders
    .flatMap((order) => order.comments)
    .filter(
      (comment, index, all) =>
        all.findIndex(
          (other) =>
            other.author === comment.author && other.text === comment.text,
        ) === index,
    );
  return OrderEntity.fromOrder({
    ...first.toOrder(),
    id: first.id,
    menus: orders.flatMap((order) => order.menus.map((menu) => menu.toMenu())),
    cups: orders.flatMap((order) => order.cups),
    comments: comments.map((comment) => comment.toComment()),
    discountOrderId:
      orders.find((order) => order.discountOrderId !== null)?.discountOrderId ??
      null,
    // 注文ごとに引いた杯数の合計（それぞれの注文のコーヒーの杯数までしか引いていない）
    discountOrderCups: orders.reduce(
      (acc, order) => acc + order.discount / order.DISCOUNT_PER_CUP,
      0,
    ),
    readyAt: latest(orders.map((order) => order.readyAt)),
    servedAt: latest(orders.map((order) => order.servedAt)),
  });
};

/**
 * 注文を分割グループにまとめる。並びは 1 つ目の注文の並びのまま。1 つ目の注文が無い（消えた）分けた注文は、
 * それだけで 1 件にする
 */
export const groupPastOrders = (
  orders: readonly WithId<OrderEntity>[],
): PastOrderGroup[] => {
  const ids = new Set(orders.map((order) => order.id));
  const splits = new Map<string, WithId<OrderEntity>[]>();
  for (const order of orders) {
    if (order.splitParentId !== null && ids.has(order.splitParentId)) {
      splits.set(order.splitParentId, [
        ...(splits.get(order.splitParentId) ?? []),
        order,
      ]);
    }
  }
  return orders
    .filter(
      (order) => order.splitParentId === null || !ids.has(order.splitParentId),
    )
    .map((first) => {
      const mine = (splits.get(first.id) ?? []).sort(
        (a, b) => a.orderId - b.orderId,
      );
      return {
        orders: [first, ...mine],
        orderIds: [first.orderId, ...mine.map((order) => order.orderId)],
        order: mine.length === 0 ? first : combineOrders(first, mine),
      };
    });
};
