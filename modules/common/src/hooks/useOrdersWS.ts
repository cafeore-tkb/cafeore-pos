// hooks/useOrdersWS.ts
import { useEffect, useState } from "react";
import { type MasterState, responseToMasterState } from "../data";
import {
  type OrderResponse,
  type PrintJobResponse,
  responseToCashierState,
  responseToOrderEntity,
  responseToPrintJob,
} from "../firebase-utils";
import type { WithId } from "../lib";
import {
  type ReconnectingWebSocketStatus,
  createReconnectingWebSocket,
} from "../lib/reconnectingWebSocket";
import type { CashierStateEntity, OrderEntity, PrintJob } from "../models";
import type { CaosDrip, CaosLane } from "../repositories/caos";
import type { components } from "../types/api";

type WsStatus = ReconnectingWebSocketStatus;

type WSMessage =
  // 全注文。接続直後に届く
  | { type: "orders"; orders?: OrderResponse[] }
  // 作成・変更された1件の注文
  | { type: "order"; order: OrderResponse }
  | { type: "order_deleted"; order_id: string }
  | {
      type: "master_state";
      master_state: { created_at: string; type: string };
    }
  | {
      type: "cashier_state";
      cashier_state: components["schemas"]["CashierStateResponse"];
    }
  // CaOS（ドリップ管制）の今日の抽出カードと列の担当者（1〜6）。変わるたびに全部届く（カードが 0 件なら drips は省かれる）
  | { type: "drips"; drips?: CaosDrip[]; lanes?: CaosLane[] }
  // 印刷キューの、まだ終わっていない仕事（待ち・印刷中・失敗）の全部。変わるたびと、つないだときに届く（0 件なら print_jobs は省かれる）
  | { type: "print_jobs"; print_jobs?: PrintJobResponse[] };

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
  // CaOS の画面のためのもの。POS のほかの画面は使わない。未受信は undefined
  const [drips, setDrips] = useState<CaosDrip[]>();
  // CaOS の列の担当者。未受信は undefined
  const [lanes, setLanes] = useState<CaosLane[]>();
  // 印刷キューの、まだ終わっていない仕事。未受信は undefined
  const [printJobs, setPrintJobs] = useState<PrintJob[]>();
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
            setOrders((data.orders ?? []).map(responseToOrderEntity));
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
            setMasterState(responseToMasterState(data.master_state));
            break;

          case "cashier_state":
            setCashierState(responseToCashierState(data.cashier_state));
            break;

          case "drips":
            setDrips(data.drips ?? []);
            setLanes(data.lanes ?? []);
            break;

          case "print_jobs":
            setPrintJobs((data.print_jobs ?? []).map(responseToPrintJob));
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
    /** レジの編集中注文と直前に確定した注文 ID。未受信なら null */
    cashierState,
    /** CaOS の今日の抽出カード。未受信なら null */
    drips: drips ?? null,
    /** CaOS の今日の列の担当者（1〜6）。未受信なら null */
    lanes: lanes ?? null,
    /** 印刷キューの、まだ終わっていない仕事（積んだ順）。未受信なら null */
    printJobs: printJobs ?? null,
    status,
  };
};
