import { useEffect, useState } from "react";
import { type PosOrder, posOrdersSocketUrl } from "../utils/posOrders";

export type PosConnectionStatus =
  | "off"
  | "connecting"
  | "open"
  | "reconnecting";

type PosSocketMessage =
  | { type: "orders"; orders?: PosOrder[] }
  | { type: "master_state" };

// cafeore-pos と同じ DB の注文を WebSocket で受け取る。
// サーバーは接続直後と注文が変わるたびに全注文を送ってくるので、受け取った一覧で置き換える。
export const usePosOrders = (enabled: boolean, baseUrl: string) => {
  const [orders, setOrders] = useState<PosOrder[] | null>(null);
  const [status, setStatus] = useState<PosConnectionStatus>("off");

  useEffect(() => {
    if (!enabled) {
      setOrders(null);
      setStatus("off");
      return;
    }
    let socket: WebSocket | null = null;
    let retryTimer: number | undefined;
    let retryDelayMs = 1_000;
    let disposed = false;

    const connect = () => {
      socket = new WebSocket(posOrdersSocketUrl(baseUrl));
      socket.onopen = () => {
        retryDelayMs = 1_000;
        setStatus("open");
      };
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as PosSocketMessage;
          // 注文が0件だと orders は省かれて届く。
          if (message.type === "orders") setOrders(message.orders ?? []);
        } catch (error) {
          console.error("Failed to parse cafeore-pos message", error);
        }
      };
      // Cloud Run はリクエストの上限時間で WebSocket を切るので、切れたら間隔を空けてつなぎ直す。
      socket.onclose = () => {
        if (disposed) return;
        setStatus("reconnecting");
        retryTimer = window.setTimeout(connect, retryDelayMs);
        retryDelayMs = Math.min(retryDelayMs * 2, 15_000);
      };
    };

    setStatus("connecting");
    connect();
    return () => {
      disposed = true;
      window.clearTimeout(retryTimer);
      socket?.close();
    };
  }, [enabled, baseUrl]);

  return { orders, status };
};
