import type { OrderEntity, WithId } from "@cafeore/common";
import { useEffect, useState } from "react";
import {
  PREVIEW_ORDERS_KEY,
  PREVIEW_ORDERS_UPDATED_EVENT,
  getPreviewOrders,
} from "./localOrderStore";

export const usePreviewOrders = (): WithId<OrderEntity>[] => {
  const [orders, setOrders] = useState<WithId<OrderEntity>[]>(() =>
    getPreviewOrders(),
  );

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key == null || event.key === PREVIEW_ORDERS_KEY) {
        setOrders(getPreviewOrders());
      }
    };
    const onUpdated = () => {
      setOrders(getPreviewOrders());
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(PREVIEW_ORDERS_UPDATED_EVENT, onUpdated);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(PREVIEW_ORDERS_UPDATED_EVENT, onUpdated);
    };
  }, []);

  return orders;
};
