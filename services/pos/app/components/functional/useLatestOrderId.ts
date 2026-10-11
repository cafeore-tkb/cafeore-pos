import type { OrderEntity, WithId } from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";

/**
 * オーダーリストから最大のorderIdを算出する
 * @param orders オーダーのリスト（undefinedの場合は0を返す）
 * @returns 最大のorderId（空の場合は0）
 */
const calcLatestOrderId = (orders: WithId<OrderEntity>[] | undefined): number =>
  orders?.reduce((acc, cur) => Math.max(acc, cur.orderId), 0) ?? 0;

/**
 * 手動でorderIdを上書きするための状態と操作を提供する
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
 * 保存がまだ届いていない（遅い・失敗した）注文と同じ番号にならないよう、このレジが最後に出した番号も数える
 * @param orders オーダーのリスト
 * @returns 次のID、手動指定値、オーバーライド用の setter（null で自動に戻す）、出した番号を覚える関数
 */
const useLatestOrderId = (orders: WithId<OrderEntity>[] | undefined) => {
  const { manualOrderId, setOrderIdOverride } = useOrderIdOverride();
  const [lastIssuedOrderId, setLastIssuedOrderId] = useState(0);

  const latestOrderId = useMemo(() => calcLatestOrderId(orders), [orders]);
  const nextOrderId =
    manualOrderId ?? Math.max(latestOrderId, lastIssuedOrderId) + 1;

  return {
    nextOrderId,
    manualOrderId,
    setOrderIdOverride,
    markOrderIdIssued: setLastIssuedOrderId,
  };
};

export { useLatestOrderId };
