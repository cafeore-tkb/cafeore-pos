import { useInventory } from "@cafeore/common";
import { useMemo } from "react";
import { buildBeanIndex } from "../logic/beans";

// 豆の在庫は POS の在庫（GET /api/inventory）をそのまま使う。CaOS では在庫を持たず、減らしもしない。
// - statuses：アイテムの在庫（kind が item）の残量。豆キューに出す（棚卸し・入荷の記録は POS に書く）
// - beanIndex：商品 ID → その商品の在庫。カードの豆を決める
// TODO(#870): 豆キューに出すアイテムの在庫を絞るのは #870 で決める
export const useBeanInventory = () => {
  const inventory = useInventory();
  const statuses = useMemo(
    () =>
      inventory.statuses.filter((status) => status.resource.kind === "item"),
    [inventory.statuses],
  );
  const beanIndex = useMemo(() => buildBeanIndex(statuses), [statuses]);
  return {
    statuses,
    beanIndex,
    inventoryError: inventory.error,
    isLoading: inventory.isLoading,
    // 豆キューで棚卸し・入荷を記録したら残量を取り直す
    onRecorded: () => void inventory.mutateInventory(),
  };
};
