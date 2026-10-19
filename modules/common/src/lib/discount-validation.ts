import type { OrderEntity } from "../models/order";
import type { WithId } from "./typeguard";

/**
 * 割引の参照オーダーの状態を判定する
 *
 * 返金した注文（一部でも）の番号は使えない。キャンセルしても返金していなければ、お金はもらっているので
 * 提供していなくても使える。返金した注文で使った番号は、使っていないことにする（注文を消したときと同じ）
 * @param orderId チェックしたいオーダーID
 * @param allOrders 全てのオーダー（キャンセルした注文も含む。既に使用されているかどうかを判定するため）
 * @returns オーダーの状態
 */
export function getDiscountOrderStatus(
  orderId: number,
  allOrders: WithId<OrderEntity>[],
): "available" | "already_used" | "unserved" | "refunded" {
  const targetOrder = allOrders.find((order) => order.orderId === orderId);

  if (!targetOrder) {
    return "unserved";
  }

  // 分けた注文の 2 つ目以降は、支払いを持つ 1 つ目の注文で返金したかを見る
  const isRefunded = (order: WithId<OrderEntity>) => {
    const paid =
      order.splitParentId === null
        ? order
        : allOrders.find((parent) => parent.id === order.splitParentId);
    return paid?.isRefunded() ?? false;
  };

  // 返金した注文の番号は使えない
  if (isRefunded(targetOrder)) {
    return "refunded";
  }

  // 既に割引として使用されているかどうかを判定する
  const isAlreadyUsed = allOrders.some(
    (order) => order.discountOrderId === orderId && !isRefunded(order),
  );

  // 既に他のオーダーで割引として使用されている場合は使用できない
  if (isAlreadyUsed) {
    return "already_used";
  }

  // 提供済み（キャンセルしたが返金していない注文も）で未使用の場合は利用可能
  if (targetOrder.servedAt !== null || targetOrder.isCancelled()) {
    return "available";
  }

  // まだ提供されていないオーダーは使用できない
  return "unserved";
}
