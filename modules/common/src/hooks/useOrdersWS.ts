// hooks/useOrdersWS.ts
import { useEffect, useMemo, useRef, useState } from "react";
import { apiWebSocketUrl } from "../api/client";
import {
  type OrderResponse,
  responseToCashierState,
  responseToOrderEntity,
} from "../api/converter";
import { type MasterState, responseToMasterState } from "../data";
import type { WithId } from "../lib";
import type { CaosLanes } from "../lib/caosLanes";
import {
  type ReconnectingWebSocketStatus,
  createReconnectingWebSocket,
} from "../lib/reconnectingWebSocket";
import type { CashierStateEntity, OrderEntity } from "../models";
import type { LabelPrintRequest } from "../repositories/labelPrint";
import type { components } from "../types/api";

type WsStatus = ReconnectingWebSocketStatus;

type WSMessage =
  // 全注文。接続直後に届く
  | { type: "orders"; orders?: OrderResponse[] }
  // 作成・変更された1件の注文
  | { type: "order"; order: OrderResponse }
  | { type: "order_deleted"; order_id: string }
  // 最新のオーダーストップの状態。接続直後と切り替えのたびに届く
  | {
      type: "master_state";
      master_state: components["schemas"]["MasterStateResponse"];
    }
  | {
      type: "cashier_state";
      cashier_state: components["schemas"]["CashierStateResponse"];
    }
  // CaOS のドリッパーの担当者（今日の 6 つ全部）。変わるたびと、つないだとき（今日の担当者があれば）に届く
  | { type: "caos_lanes"; caos_lanes: CaosLanes }
  // 取り消された緊急（淹れ直し）の id。取り消したときに 1 回だけ届く（つないだときには届かない）
  | { type: "cup_emergency_cancelled"; cup_emergency_id: string }
  // 呼び出し催促した注文の id。催促したときに 1 回だけ届く（つないだときには届かない）
  | { type: "order_recalled"; order_id: string }
  // 代理印刷の頼み。頼まれたときと、刷れなかったレジが引き受けをやめたときに届く（つないだときには届かない。GET /api/label-print-requests で読む）
  | { type: "label_print_requested"; label_print_request: LabelPrintRequest }
  // 刷れた代理印刷の id
  | { type: "label_print_done"; label_print_request_id: string };

// orders 未受信時に返す固定の空配列
// 毎回リテラルを返すと参照が変わり、依存配列に orders を持つ側が無駄に再実行されるため定数化している
const EMPTY_ORDERS: WithId<OrderEntity>[] = [];

/**
 * 共有の WebSocket（/api/ws/orders）。注文・オーダーストップ・レジの状態・CaOS の担当者を持つ。
 * onCupEmergencyCancelled は緊急（淹れ直し）が取り消されたという知らせを受けたときだけ呼ぶ（注文の一覧から消えたことでは呼ばない）。
 * onOrderRecalled は呼び出し催促の知らせを受けたときに、その注文の id で呼ぶ。
 * onLabelPrintRequested・onLabelPrintDone は代理印刷の頼み・刷れたという知らせを受けたときに呼ぶ
 */
export const useOrdersWS = ({
  onCupEmergencyCancelled,
  onOrderRecalled,
  onLabelPrintRequested,
  onLabelPrintDone,
}: {
  onCupEmergencyCancelled?: (id: string) => void;
  onOrderRecalled?: (orderId: string) => void;
  onLabelPrintRequested?: (request: LabelPrintRequest) => void;
  onLabelPrintDone?: (id: string) => void;
} = {}) => {
  // 「未受信」と「受信したが0件」を区別するため、初期値は undefined
  const [orders, setOrders] = useState<WithId<OrderEntity>[]>();
  // 削除通知はIDだけなので、直前の受信注文から表示用番号を引く。
  const knownOrdersRef = useRef(new Map<string, WithId<OrderEntity>>());
  const [lastDeletedOrder, setLastDeletedOrder] = useState<{
    id: string;
    orderNo: number;
    receivedAtMs: number;
  } | null>(null);
  // オーダーストップの状態。記録がまだ無ければサーバーは何も流さないので null のまま。
  // 切断しても null に戻さず、最後に受け取った状態を保つ（つなぎ直すとサーバーが最新を送ってくる）
  const [masterState, setMasterState] = useState<MasterState | null>(null);
  // レジの編集中注文。API にまだ無ければサーバーは何も流さないので null のまま
  const [cashierState, setCashierState] = useState<CashierStateEntity | null>(
    null,
  );
  // CaOS のドリッパーの担当者。まだ届いていなければ null（担当者なし）
  const [caosLanes, setCaosLanes] = useState<CaosLanes | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");
  // つなぎ直さずに最新の関数を呼ぶ
  const onCancelledRef = useRef(onCupEmergencyCancelled);
  onCancelledRef.current = onCupEmergencyCancelled;
  const onRecalledRef = useRef(onOrderRecalled);
  onRecalledRef.current = onOrderRecalled;
  const onLabelPrintRequestedRef = useRef(onLabelPrintRequested);
  onLabelPrintRequestedRef.current = onLabelPrintRequested;
  const onLabelPrintDoneRef = useRef(onLabelPrintDone);
  onLabelPrintDoneRef.current = onLabelPrintDone;

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      try {
        const data: WSMessage = JSON.parse(e.data);

        switch (data.type) {
          case "orders": {
            const snapshot = (data.orders ?? []).map(responseToOrderEntity);
            knownOrdersRef.current = new Map(
              snapshot.map((order) => [order.id, order]),
            );
            setOrders(snapshot);
            break;
          }

          case "order": {
            // 変わった注文だけ作り直し、他の注文はそのまま使う
            const order = responseToOrderEntity(data.order);
            const previous = knownOrdersRef.current.get(order.id);
            if (previous && !previous.isCancelled() && order.isCancelled())
              setLastDeletedOrder({
                id: order.id,
                orderNo: order.orderId,
                receivedAtMs: Date.now(),
              });
            knownOrdersRef.current.set(order.id, order);
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

          case "order_deleted": {
            const deleted = knownOrdersRef.current.get(data.order_id);
            if (deleted)
              setLastDeletedOrder({
                id: deleted.id,
                orderNo: deleted.orderId,
                receivedAtMs: Date.now(),
              });
            knownOrdersRef.current.delete(data.order_id);
            setOrders((prev) => prev?.filter((o) => o.id !== data.order_id));
            break;
          }

          case "master_state":
            setMasterState(responseToMasterState(data.master_state));
            break;

          case "cashier_state":
            setCashierState(responseToCashierState(data.cashier_state));
            break;

          case "caos_lanes":
            setCaosLanes(data.caos_lanes);
            break;

          case "cup_emergency_cancelled":
            onCancelledRef.current?.(data.cup_emergency_id);
            break;

          case "order_recalled":
            onRecalledRef.current?.(data.order_id);
            break;

          case "label_print_requested":
            onLabelPrintRequestedRef.current?.(data.label_print_request);
            break;

          case "label_print_done":
            onLabelPrintDoneRef.current?.(data.label_print_request_id);
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
      url: apiWebSocketUrl("/api/ws/orders"),
      onMessage: handleMessage,
      onStatusChange: setStatus,
    });

    return () => {
      connection.close();
    };
  }, []);

  // キャンセルした注文は、注文を消したときと同じく作る画面（マスター・提供・CaOS・呼び出し）や集計に出さない。
  // キャンセルが無ければ受け取った配列をそのまま返し、参照を変えない（参照で比べる側が無駄に動かないように）
  const activeOrders = useMemo(
    () =>
      orders?.some((order) => order.isCancelled())
        ? orders.filter((order) => !order.isCancelled())
        : orders,
    [orders],
  );

  return {
    /** 削除またはキャンセルへの状態変更で受けた直近のキャンセル。未受信ならnull */
    lastDeletedOrder,
    /** キャンセルしていない注文 */
    orders: activeOrders ?? EMPTY_ORDERS,
    /** キャンセルした注文も含む全部の注文（レジの番号・引換券・過去の注文に使う） */
    allOrders: orders ?? EMPTY_ORDERS,
    /** WebSocket から一度でも orders を受信したか */
    isOrdersLoaded: orders !== undefined,
    masterState,
    /** レジの編集中注文と直前に確定した注文 ID。未受信なら null */
    cashierState,
    /** CaOS のドリッパーの担当者（日付つき）。未受信なら null */
    caosLanes,
    status,
  };
};
