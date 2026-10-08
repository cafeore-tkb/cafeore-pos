// data/inventory.ts
import useSWR from "swr";
import { inventoryRepository } from "../repositories/inventory";

const INVENTORY_KEY = "inventory";
const STOCK_USAGES_KEY = "stock-usages";

// 注文のたびに WebSocket で配ってはいないので、開いている間は定期的に取り直す。
export const INVENTORY_REFRESH_MS = 30 * 1000;

export const useInventory = () => {
  const { data, error, isLoading, mutate } = useSWR(
    INVENTORY_KEY,
    inventoryRepository.getStatuses,
    { refreshInterval: INVENTORY_REFRESH_MS },
  );

  return {
    statuses: data ?? [],
    error,
    isLoading,
    mutateInventory: mutate,
  };
};

// 開いたままの画面（CaOS など）で設定の変更を拾いたいときは refreshInterval を渡す。
// 在庫の設定の画面は自分で mutateUsages するので、既定では取り直さない。
export const useStockUsages = (options?: { refreshInterval?: number }) => {
  const { data, error, isLoading, mutate } = useSWR(
    STOCK_USAGES_KEY,
    inventoryRepository.getUsages,
    { refreshInterval: options?.refreshInterval },
  );

  return {
    usages: data ?? [],
    error,
    isLoading,
    mutateUsages: mutate,
  };
};
