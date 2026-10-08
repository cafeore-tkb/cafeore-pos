import {
  INVENTORY_REFRESH_MS,
  useInventory,
  useStockUsages,
} from "@cafeore/common";
import { useMemo } from "react";
import { buildBeanIndex } from "../logic/beans";

// 豆の在庫は POS の在庫（GET /api/inventory）と在庫の設定（GET /api/inventory/usages）をそのまま使う。
// CaOS では在庫を持たず、減らしもしない。
// - statuses：在庫対象のうち豆（kind が bean）の残量。豆キューに出す
// - beanIndex：商品 ID → 豆（在庫の設定の「商品ごとの使用量」）。カードの豆を決める
// 使用量も残量と同じ間隔で取り直し、開いたあとの設定の変更をカードに反映する。

export const useBeanInventory = () => {
  const inventory = useInventory();
  const stockUsages = useStockUsages({ refreshInterval: INVENTORY_REFRESH_MS });
  const statuses = useMemo(
    () =>
      inventory.statuses.filter((status) => status.resource.kind === "bean"),
    [inventory.statuses],
  );
  const beanIndex = useMemo(
    () => buildBeanIndex(statuses, stockUsages.usages),
    [statuses, stockUsages.usages],
  );
  return {
    statuses,
    beanIndex,
    // 使用量を読めないと全カードの豆が空になるので、残量と合わせて出す
    error: inventory.error ?? stockUsages.error,
    isLoading: inventory.isLoading || stockUsages.isLoading,
  };
};
