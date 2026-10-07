import type { CaosLane } from "@cafeore/common";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";
import type { Drip, PosOrder } from "../utils/posOrders";

export type PosConnectionStatus =
  | "off"
  | "connecting"
  | "open"
  | "reconnecting";

// 注文と今日の抽出カードは、POS の画面全体で共有している WebSocket（root の OrdersWSProvider）から受け取る。
// CaOS 用に別の接続は張らない。
// - 注文：つないだ直後に全部、そのあとは変わった 1 件ずつ届き、共有の側でまとめてある
// - カード：つないだ直後と、変わるたびに今日の分が全部届く
// - 列の担当者：カードと同じメッセージで、1〜6 の全部が届く
// enabled が false（実データテスト中）のときは注文とカードを渡さない（列の担当者は人のことなので渡す）。
export const usePosOrders = (
  enabled: boolean,
): {
  orders: PosOrder[] | null;
  drips: Drip[] | null;
  lanes: CaosLane[] | null;
  status: PosConnectionStatus;
} => {
  const { orders, isOrdersLoaded, drips, lanes, status } = useOrdersWSContext();
  if (!enabled) return { orders: null, drips: null, lanes, status: "off" };
  return {
    orders: isOrdersLoaded ? orders : null,
    drips,
    lanes,
    // 共有の接続は切れると自動でつなぎ直すので、closed は「再接続中」と出す
    status:
      status === "open"
        ? "open"
        : status === "connecting"
          ? "connecting"
          : "reconnecting",
  };
};
