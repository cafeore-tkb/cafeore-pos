import {
  type OrderEntity,
  collectionSub,
  orderConverter,
} from "@cafeore/common";
import { useEffect, useRef } from "react";
import useSWRSubscription from "swr/subscription";

type UseObserveEmergencyOptions = {
  onEmergencyAdded?: (order: OrderEntity) => void;
};

export const useObserveEmergency = (options?: UseObserveEmergencyOptions) => {
  const { data: emergencies } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }),
  );

  const emergencyOrders = emergencies?.filter((order) =>
    order.items.some((item) => item.emergency),
  );

  // 前回の緊急オーダーIDを保持
  const previousEmergencyIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!emergencyOrders || !options?.onEmergencyAdded) {
      return;
    }

    // 新しく追加された緊急オーダーを検出
    const currentEmergencyIds = new Set(
      emergencyOrders
        .map((order) => order.id)
        .filter((id): id is string => id !== undefined),
    );

    const newEmergencyOrders = emergencyOrders.filter(
      (order) => order.id && !previousEmergencyIdsRef.current.has(order.id),
    );

    // 新しい緊急オーダーがあればコールバックを実行
    for (const order of newEmergencyOrders) {
      options.onEmergencyAdded(order);
    }

    // 現在の状態を保存
    previousEmergencyIdsRef.current = currentEmergencyIds;
  }, [emergencyOrders, options]);

  return { emergencyOrders };
};
