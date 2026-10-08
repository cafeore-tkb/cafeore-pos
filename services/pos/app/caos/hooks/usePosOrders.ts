import type { OrderEntity, WithId } from "@cafeore/common";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";

// cafeore-pos の注文。POS の画面と同じく、共有の WebSocket から届いた OrderEntity を使う。
type PosOrder = WithId<OrderEntity>;

export type PosConnectionStatus =
  | "off"
  | "connecting"
  | "open"
  | "reconnecting";

// 注文は、POS の画面全体で共有している WebSocket（root の OrdersWSProvider）から受け取る。CaOS 用に別の接続は張らない。
// つないだ直後に全部、そのあとは変わった 1 件ずつ届き、共有の側でまとめてある。
// CaOS の盤面は注文のカップの列で持つので、カードはこの注文から組み立てる（@cafeore/common の buildCaosCards）。
// enabled が false（実データテスト中）のときは何も渡さない。
export const usePosOrders = (
  enabled: boolean,
): {
  orders: PosOrder[] | null;
  status: PosConnectionStatus;
} => {
  const { orders, isOrdersLoaded, status } = useOrdersWSContext();
  if (!enabled) return { orders: null, status: "off" };
  return {
    orders: isOrdersLoaded ? orders : null,
    // 共有の接続は切れると自動でつなぎ直すので、closed は「再接続中」と出す
    status: status === "closed" ? "reconnecting" : status,
  };
};
