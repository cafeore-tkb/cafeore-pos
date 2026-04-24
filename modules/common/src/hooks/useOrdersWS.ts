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

export const useOrdersWS = () => {
  const [orders, setOrders] = useState<WithId<OrderEntity>[]>([]);
  const [masterState, setMasterState] = useState<MasterState | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8080/api/ws/orders");

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

  return { orders, masterState, status };
};
