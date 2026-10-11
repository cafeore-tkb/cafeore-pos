// data/inventory.ts
import useSWR from "swr";
import { inventoryRepository } from "../repositories/inventory";

const INVENTORY_KEY = "inventory";

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
    error,
    isLoading,
    mutateInventory: mutate,
  };
};
