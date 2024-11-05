import type { OrderEntity } from "@cafeore/common";
import { useEffect } from "react";

export const useSyncCahiserOrder = (
  order: OrderEntity,
  syncOrder: (order: OrderEntity) => void,
) => {
  /**
   * FIXME #412 stateの更新にはuseEffectを使わない
   * https://ja.react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes
   */
  useEffect(() => {
    syncOrder(order);
  }, [order, syncOrder]);
};
