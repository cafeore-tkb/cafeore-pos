import { useEffect, useState } from "react";
import {
  type Drip,
  type PosOrder,
  posOrdersSocketUrl,
} from "../utils/posOrders";

export type PosConnectionStatus =
  | "off"
  | "connecting"
  | "open"
  | "reconnecting";

type PosSocketMessage =
  | { type: "orders"; orders?: PosOrder[] }
  | { type: "order"; order: PosOrder }
  | { type: "order_deleted"; order_id: string }
  | { type: "drips"; drips?: Drip[] }
  | { type: "master_state" };

// cafeore-pos の WebSocket（/api/ws/orders）で、注文と今日の抽出カードを受け取る（DB から読み直したもの）。
// - 注文：つないだ直後に全部（orders）、そのあとは変わった 1 件（order）と消えた注文の ID（order_deleted）が届く
// - カード：つないだ直後と、変わるたびに今日の分が全部（drips）届くので、受け取った一覧で置き換える
// 0 件のときは orders・drips が省かれて届く。
export const usePosOrders = (enabled: boolean, baseUrl: string) => {
  const [orders, setOrders] = useState<PosOrder[] | null>(null);
  const [drips, setDrips] = useState<Drip[] | null>(null);
  const [status, setStatus] = useState<PosConnectionStatus>("off");

  useEffect(() => {
    if (!enabled) {
      setOrders(null);
      setDrips(null);
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
          if (message.type === "orders") setOrders(message.orders ?? []);
          if (message.type === "order") {
            const order = message.order;
            // 全部が届く前の 1 件は捨てる（全部の中に入っている）
            setOrders((prev) =>
              prev === null
                ? prev
                : prev.some((o) => o.id === order.id)
                  ? prev.map((o) => (o.id === order.id ? order : o))
                  : [...prev, order],
            );
          }
          if (message.type === "order_deleted") {
            const id = message.order_id;
            setOrders((prev) => prev?.filter((o) => o.id !== id) ?? prev);
          }
          if (message.type === "drips") setDrips(message.drips ?? []);
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

  return { orders, drips, status };
};

// 抽出カードへの操作（POST /api/caos/ops）。ルールに合わないときは理由（422 の error）を返す。
export const postCaosOp = async (
  baseUrl: string,
  op: import("../utils/posOrders").CaosOp,
): Promise<
  | { result: import("../utils/posOrders").CaosOpResult; error?: undefined }
  | { result?: undefined; error: string }
> => {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/caos/ops`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok)
      return {
        error:
          (body as { error?: string } | null)?.error ||
          `操作に失敗しました（${res.status}）`,
      };
    return { result: body };
  } catch {
    return { error: "cafeore-pos につながりません" };
  }
};
