import {
  type ItemEntity,
  type OrderEntity,
  collectionSub,
  orderConverter,
} from "@cafeore/common";
import { useEffect, useRef } from "react";
import useSWRSubscription from "swr/subscription";

type UseObserveEmergencyOptions = {
  onEmergencyAdded?: (order: OrderEntity, item: ItemEntity) => void;
};

export const useObserveEmergency = (options?: UseObserveEmergencyOptions) => {
  const { data: emergencies } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }),
  );

  const emergencyOrders = emergencies?.filter((order) =>
    order.items.some((item) => item.emergency),
  );

  // 前回の緊急アイテムIDを保持（order.id + item.id の組み合わせ）
  const previousEmergencyItemsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!emergencyOrders || !options?.onEmergencyAdded) {
      return;
    }

    // 新しく追加された緊急アイテムを検出
    const currentEmergencyItems = new Set<string>();
    const newEmergencyItems: Array<{ order: OrderEntity; item: ItemEntity }> =
      [];

    for (const order of emergencyOrders) {
      if (!order.id) continue;

      for (const item of order.items) {
        if (item.emergency && item.id) {
          const itemKey = `${order.id}-${item.id}`;
          currentEmergencyItems.add(itemKey);

          if (!previousEmergencyItemsRef.current.has(itemKey)) {
            newEmergencyItems.push({ order, item });
          }
        }
      }
    }

    // 新しい緊急アイテムがあればコールバックを実行
    for (const { order, item } of newEmergencyItems) {
      options.onEmergencyAdded(order, item);
    }

    // 現在の状態を保存
    previousEmergencyItemsRef.current = currentEmergencyItems;
  }, [emergencyOrders, options]);

  return { emergencyOrders };
};
