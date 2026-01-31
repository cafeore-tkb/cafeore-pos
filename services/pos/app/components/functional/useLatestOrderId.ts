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

  // 手動で番号を設定する（オフライン時に使用）
  const setOrderIdOverride = useCallback((orderId: number | null) => {
    setManualOrderId(orderId);
  }, []);

  // 手動設定をクリアして自動モードに戻す
  const clearOrderIdOverride = useCallback(() => {
    setManualOrderId(null);
  }, []);

  return { manualOrderId, setOrderIdOverride, clearOrderIdOverride };
};

/**
 * オーダーのIDの最大値と次のIDを取得する
 * @param orders オーダーのリスト
 * @returns オーダーIDの最大値と次のID、および手動オーバーライド用の関数
 */
const useLatestOrderId = (orders: WithId<OrderEntity>[] | undefined) => {
  const isNetworkOnline = useOnlineStatus();
  const { manualOrderId, setOrderIdOverride, clearOrderIdOverride } =
    useOrderIdOverride();

  const latestOrderId = useMemo(() => calcLatestOrderId(orders), [orders]);
  // 手動指定がなければ自動採番（最大ID + 1）を使用
  const autoNextOrderId = latestOrderId + 1;
  const nextOrderId = manualOrderId ?? autoNextOrderId;
  const isNeedManualOrderId = calcCannotAutoAssignOrderId(
    isNetworkOnline,
    orders,
  );

  return {
    latestOrderId,
    nextOrderId,
    isNeedManualOrderId,
    manualOrderId,
    setOrderIdOverride,
    clearOrderIdOverride,
  };
};

export { useLatestOrderId };
