// hooks/useOrdersWS.ts
import { useEffect, useState } from "react";
import type { MasterState } from "../data";
import { type OrderResponse, responseToOrderEntity } from "../firebase-utils";
import type { WithId } from "../lib";
import type { OrderEntity } from "../models";

type WsStatus = "connecting" | "open" | "closed" | "error";

type WSMessage =
  // 全注文。接続直後に届く
  | { type: "orders"; orders: OrderResponse[] }
  // 作成・変更された1件の注文
  | { type: "order"; order: OrderResponse }
  | { type: "order_deleted"; order_id: string }
  | { type: "master_state"; master_state: MasterState };

// orders 未受信時に返す固定の空配列
// 毎回リテラルを返すと参照が変わり、依存配列に orders を持つ側が無駄に再実行されるため定数化している
const EMPTY_ORDERS: WithId<OrderEntity>[] = [];

// 再接続の間隔。失敗が続くと倍にしていき、つながったら戻す
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10000;

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
    // 切れたら（サーバーが遅い端末を切ったとき、スリープからの復帰時など）つなぎ直す。
    // 変更は1件ずつしか届かないので、つなぎ直して全件を受け取り直さないと一覧が古いままになる。
    let ws: WebSocket;
    let retryDelay = RETRY_MIN_MS;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;

    const connect = () => {
      ws = new WebSocket(`${wsUrl}/api/ws/orders`);

      setStatus("connecting");

      ws.onopen = () => {
        retryDelay = RETRY_MIN_MS;
        setStatus("open");
      };

      ws.onmessage = (e) => {
        try {
          const data: WSMessage = JSON.parse(e.data);

          switch (data.type) {
            case "orders":
              setOrders(data.orders.map(responseToOrderEntity));
              break;

            case "order": {
              // 変わった注文だけ作り直し、他の注文はそのまま使う
              const order = responseToOrderEntity(data.order);
              setOrders((prev) => {
                // 全件より先には届かないが、届いても全件を待つ
                if (prev === undefined) return prev;
                const index = prev.findIndex((o) => o.id === order.id);
                if (index === -1) return [...prev, order];
                const next = [...prev];
                next[index] = order;
                return next;
              });
              break;
            }

            case "order_deleted":
              setOrders((prev) => prev?.filter((o) => o.id !== data.order_id));
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
        if (disposed) return;
        retryTimer = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      clearTimeout(retryTimer);
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
