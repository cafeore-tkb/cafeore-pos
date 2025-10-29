import type { OrderEntity } from "../models/order";
import type { WithId } from "./typeguard";

/**
 * 割引の参照オーダーの状態を判定する
 * @param orderId チェックしたいオーダーID
 * @param allOrders 全てのオーダー（既に使用されているかどうかを判定するため）
 * @returns オーダーの状態
 */
export function getDiscountOrderStatus(
  orderId: number,
  allOrders: WithId<OrderEntity>[],
): "available" | "already_used" | "unserved" {
  const targetOrder = allOrders.find((order) => order.orderId === orderId);

  if (!targetOrder) {
    return "unserved";
  }

  // 既に割引として使用されているかどうかを判定する
  const isAlreadyUsed = allOrders.some(
    (order) => order.discountOrderId === orderId,
  );

  // 既に他のオーダーで割引として使用されている場合は使用できない
  if (isAlreadyUsed) {
    return "already_used";
  }

  // 提供済みで未使用の場合は利用可能
  if (targetOrder.servedAt !== null) {
    return "available";
  }

  // まだ提供されていないオーダーは使用できない
  return "unserved";
}
