import type { OrderEntity } from "common/models/order";
import { useEffect } from "react";

export const useSyncCahiserOrder = (
  order: OrderEntity,
  syncOrder: (order: OrderEntity) => void,
) => {
  useEffect(() => {
    syncOrder(order);
  }, [order, syncOrder]);
};
