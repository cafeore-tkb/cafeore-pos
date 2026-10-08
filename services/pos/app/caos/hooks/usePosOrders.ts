import type { CaosCard } from "@cafeore/common";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import type { PosOrder } from "../utils/posOrders";

export type PosConnectionStatus =
  | "off"
  | "connecting"
  | "open"
  | "reconnecting";

// 注文と今日の盤面（カード）は、POS の画面全体で共有している WebSocket（root の OrdersWSProvider）から受け取る。
// CaOS 用に別の接続は張らない。
// - 注文：つないだ直後に全部、そのあとは変わった 1 件ずつ届き、共有の側でまとめてある
// - 盤面：つないだ直後と、変わるたびに（CaOS の操作・注文の変更）今日の分が全部届く
// enabled が false（実データテスト中）のときは何も渡さない。
export const usePosOrders = (
  enabled: boolean,
): {
  orders: PosOrder[] | null;
  cards: CaosCard[] | null;
  status: PosConnectionStatus;
} => {
  const { orders, isOrdersLoaded, drips, status } = useOrdersWSContext();
  if (!enabled) return { orders: null, cards: null, status: "off" };
  return {
    orders: isOrdersLoaded ? orders : null,
    cards: drips,
    // 共有の接続は切れると自動でつなぎ直すので、closed は「再接続中」と出す
    status:
      status === "open"
        ? "open"
        : status === "connecting"
          ? "connecting"
          : "reconnecting",
  };
};
