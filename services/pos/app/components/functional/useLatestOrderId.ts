import type { OrderEntity, WithId } from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
import { useOnlineStatus } from "./useOnlineStatus";

/**
 * オーダーリストから最大のorderIdを算出する
 * @param orders オーダーのリスト（undefinedの場合は0を返す）
 * @returns 最大のorderId（空の場合は0）
 */
const calcLatestOrderId = (orders: WithId<OrderEntity>[] | undefined): number =>
  orders?.reduce((acc, cur) => Math.max(acc, cur.orderId), 0) ?? 0;

/**
 * 自動採番が使えないかどうかを判定する
 * @param isNetworkOnline ネットワークがオンラインか
 * @param orders オーダーのリスト
 * @returns trueの場合、手動採番が必要（ネットワークオフライン、ordersがundefined、またはordersが空の場合）
 */
const calcCannotAutoAssignOrderId = (
  isNetworkOnline: boolean,
  orders: WithId<OrderEntity>[] | undefined,
): boolean => !isNetworkOnline || orders === undefined || orders.length === 0;

/**
 * 手動でorderIdを上書きするための状態と操作を提供する
 * オフライン時など、自動採番が使えない場合に使用
 */
const useOrderIdOverride = () => {
  const [manualOrderId, setManualOrderId] = useState<number | null>(null);

  // 手動で番号を設定する（null で自動モードに戻す）
  const setOrderIdOverride = useCallback((orderId: number | null) => {
    setManualOrderId(orderId);
  }, []);

  return { manualOrderId, setOrderIdOverride };
};

/**
 * オーダーのIDの最大値と次のIDを取得する
 * @param orders オーダーのリスト
 * @returns 次のID、手動採番要否、手動指定値、およびオーバーライド用の setter（null で自動に戻す）
 */
const useLatestOrderId = (orders: WithId<OrderEntity>[] | undefined) => {
  const isNetworkOnline = useOnlineStatus();
  const { manualOrderId, setOrderIdOverride } = useOrderIdOverride();

  const latestOrderId = useMemo(() => calcLatestOrderId(orders), [orders]);
  const nextOrderId = manualOrderId ?? latestOrderId + 1;
  const isNeedManualOrderId = calcCannotAutoAssignOrderId(
    isNetworkOnline,
    orders,
  );

  return {
    nextOrderId,
    isNeedManualOrderId,
    manualOrderId,
    setOrderIdOverride,
  };
};

export { useLatestOrderId };
