import { useInventory, useStockUsages } from "@cafeore/common";
import { useMemo } from "react";
import { buildBeanIndex } from "../logic/beans";

// 豆の在庫は POS の在庫（GET /api/inventory）と在庫の設定（GET /api/inventory/usages）をそのまま使う。
// CaOS では在庫を持たず、減らしもしない。
// - beanStatuses：在庫対象のうち豆（kind が bean）の残量。豆キューに出す
// - beanIndex：商品 ID → 豆（在庫の設定の「商品ごとの使用量」）。カードの豆を決める
// 使用量も残量と同じ間隔で取り直し、開いたあとの設定の変更をカードに反映する。
const USAGES_REFRESH_MS = 30 * 1000;

export const useBeanInventory = () => {
  const inventory = useInventory();
  const stockUsages = useStockUsages({ refreshInterval: USAGES_REFRESH_MS });
  const { statuses } = inventory;
  const { usages } = stockUsages;
  const beanStatuses = useMemo(
    () => statuses.filter((status) => status.resource.kind === "bean"),
    [statuses],
  );
  const beanIndex = useMemo(
    () => buildBeanIndex(statuses, usages),
    [statuses, usages],
  );
  return {
    beanStatuses,
    beanIndex,
    // 使用量を読めないと全カードの豆が空になるので、残量と合わせて出す
    error: inventory.error ?? stockUsages.error,
    isLoading: inventory.isLoading || stockUsages.isLoading,
  };
};
