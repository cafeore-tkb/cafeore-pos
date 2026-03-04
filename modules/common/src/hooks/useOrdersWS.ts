// hooks/useOrdersWS.ts
import { useEffect, useState } from "react";
import { responseToOrderEntity } from "../firebase-utils";
import type { WithId } from "../lib";
import type { OrderEntity } from "../models";
export const useOrdersWS = () => {
  const [orders, setOrders] = useState<WithId<OrderEntity>[]>([]);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:8080/api/ws/orders");
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      setOrders(data.map(responseToOrderEntity));
    };
    return () => {
      if (
        ws.readyState === WebSocket.OPEN ||
        ws.readyState === WebSocket.CONNECTING
      ) {
        ws.close();
      }
    };
  }, []);

  return { orders };
};
