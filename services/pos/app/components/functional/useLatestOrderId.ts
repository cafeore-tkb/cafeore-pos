import type { OrderEntity, WithId } from "@cafeore/common";
import { useCallback, useMemo, useState } from "react";
import { latestUnsentOrderId } from "./saveOrderInBackground";

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
 * 保存がまだ届いていない（遅い・失敗した・オフラインで溜めた）注文と同じ番号にならないよう、
 * このレジが出した番号のうち最大のものも数える。読み込み直しても、端末に残っている未保存の注文の番号は数える
 * @param orders オーダーのリスト
 * @param online 今すぐ保存できるか。オンラインに戻ったら手動の番号をやめ、自動の番号（届いている注文と手元の最大 + 1）に戻す
 * @returns 次のID、手動指定値、オーバーライド用の setter（null で自動に戻す）、出した番号を覚える関数
 */
const useLatestOrderId = (
  orders: WithId<OrderEntity>[] | undefined,
  online: boolean,
) => {
  const { manualOrderId, setOrderIdOverride } = useOrderIdOverride();
  const [lastIssuedOrderId, setLastIssuedOrderId] =
    useState(latestUnsentOrderId);
  const [wasOnline, setWasOnline] = useState(online);

  // オフラインで手で付けた番号のままだと、オンラインでは次の番号に進まず同じ番号が続くので、戻ったときに自動へ戻す。
  // effect で戻すと一度古い番号で描画されるので、描画中に直す
  if (online !== wasOnline) {
    setWasOnline(online);
    if (online) {
      setOrderIdOverride(null);
    }
  }

  const markOrderIdIssued = useCallback((orderId: number) => {
    setLastIssuedOrderId((prev) => Math.max(prev, orderId));
  }, []);

  const latestOrderId = useMemo(() => calcLatestOrderId(orders), [orders]);
  const nextOrderId =
    manualOrderId ?? Math.max(latestOrderId, lastIssuedOrderId) + 1;

  return {
    nextOrderId,
    manualOrderId,
    setOrderIdOverride,
    markOrderIdIssued,
  };
};

export { useLatestOrderId };
