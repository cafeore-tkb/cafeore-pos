// hooks/useOrdersWS.ts
import { useEffect, useState } from "react";
import { type MasterState, responseToMasterState } from "../data";
import { type OrderResponse, responseToOrderEntity } from "../firebase-utils";
import type { WithId } from "../lib";
import type { OrderEntity } from "../models";

type WsStatus = "connecting" | "open" | "closed" | "error";

type WSMessage =
  | { type: "orders"; orders?: OrderResponse[] }
  | {
      type: "master_state";
      master_state: { created_at: string; type: string };
    };

// orders 未受信時に返す固定の空配列
// 毎回リテラルを返すと参照が変わり、依存配列に orders を持つ側が無駄に再実行されるため定数化している
const EMPTY_ORDERS: WithId<OrderEntity>[] = [];

// 切れたときのつなぎ直しの間隔。失敗が続くたびに倍にし、上限で止める
const RETRY_INITIAL_MS = 1_000;
const RETRY_MAX_MS = 15_000;

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

    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelayMs = RETRY_INITIAL_MS;
    let disposed = false;

    const connect = () => {
      ws = new WebSocket(`${wsUrl}/api/ws/orders`);
      setStatus("connecting");

      ws.onopen = () => {
        retryDelayMs = RETRY_INITIAL_MS;
        setStatus("open");
      };

      ws.onmessage = (e) => {
        try {
          const data: WSMessage = JSON.parse(e.data);

          switch (data.type) {
            case "orders":
              // API は注文が 0 件だと orders を省いて送る（omitempty）。空として受け取る
              setOrders((data.orders ?? []).map(responseToOrderEntity));
              break;

            case "master_state":
              setMasterState(responseToMasterState(data.master_state));
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

      // Cloud Run はリクエストの上限時間（300 秒）で WebSocket を切る。
      // 切れたままだと注文が更新されず会計もできなくなるので、間隔を空けてつなぎ直す。
      // つなぎ直すとサーバーが全注文を送り直すので、切れていた間の更新も取りこぼさない。
      ws.onclose = () => {
        if (disposed) return;
        setStatus("closed");
        retryTimer = setTimeout(connect, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, RETRY_MAX_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
      ws?.close();
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
