import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";

/**
 * オーダーストップの状態を取得するフック。共有の WebSocket の master_state を見る
 * @returns 稼働中なら true、オーダーストップなら false。記録がまだ無ければ稼働中とみなす
 */
export const useOrderStat = (): boolean => {
  const { masterState } = useOrdersWSContext();
  return masterState?.type !== "stop";
};
