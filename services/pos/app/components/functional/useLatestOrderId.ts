import type { OrderEntity, WithId } from "@cafeore/common";
import { useMemo } from "react";

/**
 * オーダーのIDの最大値と次のIDを取得する
 * @param orders オーダーのリスト
 * @returns オーダーIDの最大値と次のID
 */
const useLatestOrderId = (orders: WithId<OrderEntity>[] | undefined) => {
  const latestOrderId = useMemo(
    () => orders?.reduce((acc, cur) => Math.max(acc, cur.orderId), 0) ?? 0,
    [orders],
  );
  const nextOrderId = useMemo(() => latestOrderId + 1, [latestOrderId]);

  return { latestOrderId, nextOrderId };
};
export { useLatestOrderId };
