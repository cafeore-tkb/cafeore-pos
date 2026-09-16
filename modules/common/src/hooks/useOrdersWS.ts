// hooks/useOrdersWS.ts
import { useEffect, useState } from "react";
import { type MasterState, responseToMasterState } from "../data/masterState";
import {
  type OrderResponse,
  responseToCashierState,
  responseToOrderEntity,
} from "../firebase-utils";
import type { WithId } from "../lib";
import type { CashierStateEntity, OrderEntity } from "../models";
import type { components } from "../types/api";

type WsStatus = "connecting" | "open" | "closed" | "error";

type WSMessage =
  | { type: "orders"; orders: OrderResponse[] }
  | {
      type: "master_state";
      master_state: components["schemas"]["MasterStateResponse"];
    }
  | {
      type: "cashier_state";
      cashier_state: components["schemas"]["CashierStateResponse"];
    };

// orders 未受信時に返す固定の空配列
// 毎回リテラルを返すと参照が変わり、依存配列に orders を持つ側が無駄に再実行されるため定数化している
const EMPTY_ORDERS: WithId<OrderEntity>[] = [];

export const useOrdersWS = () => {
  // 「未受信」と「受信したが0件」を区別するため、初期値は undefined
  const [orders, setOrders] = useState<WithId<OrderEntity>[]>();
  const [masterState, setMasterState] = useState<MasterState | null>(null);
  // レジの編集中注文。API にまだ無ければサーバーは何も流さないので null のまま
  const [cashierState, setCashierState] = useState<CashierStateEntity | null>(
    null,
  );
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
            setMasterState(responseToMasterState(data.master_state));
            break;

          case "cashier_state":
            setCashierState(responseToCashierState(data.cashier_state));
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
    /** 最新のオーダーストップ状態。未受信なら null */
    masterState,
    /** レジの編集中注文と直前に確定した注文 ID。未受信なら null */
    cashierState,
    status,
  };
};
