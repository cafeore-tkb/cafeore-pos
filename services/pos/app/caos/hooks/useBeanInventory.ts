import { useInventory, useItemMaster } from "@cafeore/common";
import { useMemo } from "react";
import { buildBeanIndex, dripItemStatuses } from "../logic/beans";

// 豆の在庫は POS の在庫（GET /api/inventory）をそのまま使う。CaOS では在庫を持たず、減らしもしない。
// - statuses：抽出が要るアイテムの在庫の残量。豆残量確認に出す（棚卸し・入荷の記録は POS に書く）
// - beanIndex：商品 ID → その商品の在庫。カードの豆を決める
export const useBeanInventory = () => {
  const inventory = useInventory();
  const { items } = useItemMaster();
  const statuses = useMemo(
    () => dripItemStatuses(inventory.statuses, items),
    [inventory.statuses, items],
  );
  const beanIndex = useMemo(() => buildBeanIndex(statuses), [statuses]);
  return {
    statuses,
    beanIndex,
    inventoryError: inventory.error,
    isLoading: inventory.isLoading,
    // 豆残量確認で棚卸し・入荷を記録したら残量を取り直す
    onRecorded: () => void inventory.mutateInventory(),
  };
};
