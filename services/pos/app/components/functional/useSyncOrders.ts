import { collectionSub, orderConverter } from "@cafeore/common";
import useSWRSubscription from "swr/subscription";

type props = {
  disableFirebase: boolean;
};

/**
 * Firebase からリアルタイムに同期するオーダーのリストを取得する
 * @param disableFirebase trueの場合はFirebaseに接続しない
 * @returns
 */
export const useSyncOrders = ({ disableFirebase }: props) => {
  if (disableFirebase) {
    return undefined;
  }
  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }),
  );

  return orders;
};
