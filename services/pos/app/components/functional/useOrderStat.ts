import { isOrderOperational } from "@cafeore/common";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";

/**
 * オーダーストップの状態を取得するフック
 * オーダーストップなら false, 稼働中なら true を返す
 *
 * 状態は API だけが持ち、共有の WebSocket（OrdersWSProvider）の master_state で受け取る。
 * どの画面もここを通して同じ値を見る。記録がまだ無ければ稼働中とみなす
 * @returns オーダーの状態が稼働中かどうか
 */
export const useOrderStat = (): boolean => {
  const { masterState } = useOrdersWSContext();
  return isOrderOperational(masterState);
};
