import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";

/**
 * オーダーストップの状態を取得するフック。共有の WebSocket の master_state を見る
 * 切断中は最後に受け取った状態のまま。最初に受け取るまでと、記録がまだ無いときは稼働中とみなす
 * （API は接続した直後にその接続へ最新の状態を送るので、受け取る前は一瞬だけ。記録が無いのは一度も止めていないとき）。
 * オーダーストップは表示（ヘッダー・cashier-mini・マスターのボタン）の切り替えで、レジの送信の可否には使わない
 * @returns 稼働中なら true、オーダーストップなら false
 */
export const useOrderStat = (): boolean => {
  const { masterState } = useOrdersWSContext();
  return masterState?.type !== "stop";
};
