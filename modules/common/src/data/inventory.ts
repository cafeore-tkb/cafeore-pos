// data/inventory.ts
import useSWR from "swr";
import { inventoryRepository } from "../repositories/inventory";

const INVENTORY_KEY = "inventory";
const STOCK_USAGES_KEY = "stock-usages";

// 注文のたびに WebSocket で配ってはいないので、開いている間は定期的に取り直す。
const INVENTORY_REFRESH_MS = 30 * 1000;

export const useInventory = () => {
  const { data, error, isLoading, mutate } = useSWR(
    INVENTORY_KEY,
    inventoryRepository.getStatuses,
    { refreshInterval: INVENTORY_REFRESH_MS },
  );

  return {
    statuses: data ?? [],
    // 一度でも届いたか。再取得の失敗では data が残るので、error ではなくこちらで見る
    isLoaded: data !== undefined,
    error,
    isLoading,
    mutateInventory: mutate,
  };
};

export const useStockUsages = () => {
  const { data, error, isLoading, mutate } = useSWR(
    STOCK_USAGES_KEY,
    inventoryRepository.getUsages,
  );

  return {
    usages: data ?? [],
    // 一度でも届いたか。再取得の失敗では data が残るので、error ではなくこちらで見る
    isLoaded: data !== undefined,
    error,
    isLoading,
    mutateUsages: mutate,
  };
};
