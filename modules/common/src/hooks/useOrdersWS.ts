// hooks/useOrdersWS.ts
import { useEffect, useState } from "react";
import type { MasterState } from "../data";
import { type OrderResponse, responseToOrderEntity } from "../firebase-utils";
import type { WithId } from "../lib";
import {
  type ReconnectingWebSocketStatus,
  createReconnectingWebSocket,
} from "../lib/reconnectingWebSocket";
import type { OrderEntity } from "../models";

type WsStatus = ReconnectingWebSocketStatus;

type WSMessage =
  | { type: "orders"; orders: OrderResponse[] }
  | { type: "master_state"; master_state: MasterState };

// orders 未受信時に返す固定の空配列
// 毎回リテラルを返すと参照が変わり、依存配列に orders を持つ側が無駄に再実行されるため定数化している
const EMPTY_ORDERS: WithId<OrderEntity>[] = [];

export const useOrdersWS = () => {
  // 「未受信」と「受信したが0件」を区別するため、初期値は undefined
  const [orders, setOrders] = useState<WithId<OrderEntity>[]>();
  const [masterState, setMasterState] = useState<MasterState | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");

  useEffect(() => {
    const apiBaseUrl =
      import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";
    const wsUrl = apiBaseUrl
      .replace("http://", "ws://")
      .replace("https://", "wss://");

    const handleMessage = (e: MessageEvent) => {
      try {
        const data: WSMessage = JSON.parse(e.data);

        switch (data.type) {
          case "orders":
            setOrders(data.orders.map(responseToOrderEntity));
            break;

          case "master_state":
            setMasterState(data.master_state);
            break;

          default:
            console.warn("Unknown WS message:", data);
        }
      } catch (err) {
        console.error("Failed to parse WS message:", err);
      }
    };

    // 切れたら自動でつなぎ直す。サーバーは接続直後に現在の状態を送ってくるので、それで再同期される
    const connection = createReconnectingWebSocket({
      url: `${wsUrl}/api/ws/orders`,
      onMessage: handleMessage,
      onStatusChange: setStatus,
    });

    return () => {
      connection.close();
    };
  }, []);

  return {
    orders: orders ?? EMPTY_ORDERS,
    /** WebSocket から一度でも orders を受信したか */
    isOrdersLoaded: orders !== undefined,
    masterState,
    status,
  };
};
