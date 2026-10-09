import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";

/**
 * オーダーストップの状態を取得するフック。共有の WebSocket の master_state を見る
 * 切断中は最後に受け取った状態のまま。最初に受け取るまでと、記録がまだ無いときは稼働中とみなす
 * @returns 稼働中なら true、オーダーストップなら false
 */
export const useOrderStat = (): boolean => {
  const { masterState } = useOrdersWSContext();
  return masterState?.type !== "stop";
};
