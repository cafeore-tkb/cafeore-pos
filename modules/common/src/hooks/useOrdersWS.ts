// hooks/useOrdersWS.ts
import { useEffect, useState } from "react";
import type { MasterState } from "../data";
import { type OrderResponse, responseToOrderEntity } from "../firebase-utils";
import type { WithId } from "../lib";
import type { OrderEntity } from "../models";

type WsStatus = "connecting" | "open" | "closed" | "error";

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
    const ws = new WebSocket(`${wsUrl}/api/ws/orders`);

    setStatus("connecting");

    ws.onopen = () => {
      setStatus("open");
    };

    ws.onmessage = (e) => {
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

    ws.onerror = () => {
      setStatus("error");
    };

    ws.onclose = () => {
      setStatus("closed");
    };

    return () => {
      ws.close();
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
