import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";

/**
 * オーダーストップの状態を取得するフック
 * オーダーストップなら false, 稼働中なら true を返す
 *
 * 状態は API の WebSocket（master_state）から来る。
 * まだ受信していなければ稼働中とみなす。
 * @returns オーダーの状態が稼働中かどうか
 */
export const useOrderStat = (): boolean => {
  const { masterState } = useOrdersWSContext();
  if (masterState == null) {
    return true;
  }
  return masterState.type !== "stop";
};
