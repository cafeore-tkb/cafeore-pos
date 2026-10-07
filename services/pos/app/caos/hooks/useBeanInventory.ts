import { useInventory, useStockUsages } from "@cafeore/common";
import { useMemo } from "react";
import { buildBeanIndex } from "../utils/beans";

// 豆の在庫は POS の在庫（GET /api/inventory）をそのまま使う。CaOS では在庫を持たず、減らしもしない。
// - beanStatuses：在庫対象のうち豆（kind が bean）の残量。豆のパネルに出す
// - beanIndex：商品 ID → 豆（在庫の設定の「商品ごとの使用量」）。カードがどの豆かを決める
export const useBeanInventory = () => {
  const { statuses, error, isLoading } = useInventory();
  const { usages } = useStockUsages();
  const beanStatuses = useMemo(
    () => statuses.filter((status) => status.resource.kind === "bean"),
    [statuses],
  );
  const beanIndex = useMemo(
    () => buildBeanIndex(statuses, usages),
    [statuses, usages],
  );
  return { beanStatuses, beanIndex, error, isLoading };
};
