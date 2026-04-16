// hooks/useOrdersWS.ts
import { useEffect, useState } from "react";
import { responseToOrderEntity } from "../firebase-utils";
import type { WithId } from "../lib";
import type { OrderEntity } from "../models";

type WsStatus = "connecting" | "open" | "closed" | "error";

export const useOrdersWS = () => {
  const [orders, setOrders] = useState<WithId<OrderEntity>[]>([]);
  const [status, setStatus] = useState<WsStatus>("connecting");

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8080/api/ws/orders");

    setStatus("connecting");

    ws.onopen = () => {
      setStatus("open");
    };

    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setOrders(data.map(responseToOrderEntity));
    };

    ws.onerror = () => {
      setStatus("error");
    };

    ws.onclose = () => {
      setStatus("closed");
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    };
  }, []);

  return { orders, status };
};
