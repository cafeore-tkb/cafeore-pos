import { type LabelPrintRequest, useOrdersWS } from "@cafeore/common";
// context/OrdersWSContext.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import {
  cancelPendingPrint,
  completePendingPrint,
} from "~/label/pending-prints";

/** データのリセットの画面（routes/data-reset.tsx） */
export const DATA_RESET_PATH = "/data-reset";

type RecallListener = (orderId: string) => void;

/** 代理印刷の知らせ。頼まれた（requested）・刷れた（done）・緊急が取り消された（cancelled。その淹れ直しのシールの頼みも消える） */
export type LabelPrintEvent =
  | { type: "requested"; request: LabelPrintRequest }
  | { type: "done" | "cancelled"; id: string };

type LabelPrintListener = (event: LabelPrintEvent) => void;

type OrdersWSContextValue = ReturnType<typeof useOrdersWS> & {
  /** 呼び出し催促の知らせを受け取る関数を足す。外す関数を返す（useOrderRecalled から使う） */
  subscribeRecall: (listener: RecallListener) => () => void;
  /** 代理印刷の知らせを受け取る関数を足す。外す関数を返す（useLabelPrintEvents から使う） */
  subscribeLabelPrints: (listener: LabelPrintListener) => () => void;
};

/** listeners に listener を足し、外す関数を返す */
const addListener = <T,>(listeners: Set<T>, listener: T) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const OrdersWSContext = createContext<OrdersWSContextValue | null>(null);

export const OrdersWSProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  // 呼び出し催促は状態ではなく 1 回ずつの知らせなので、受け取りたい画面（useOrderRecalled）にそのまま渡す
  const recallListenersRef = useRef(new Set<RecallListener>());
  // 代理印刷の知らせも、受け取りたい画面（レジの代理印刷・CaOS の印刷待ちの数）にそのまま渡す
  const labelPrintListenersRef = useRef(new Set<LabelPrintListener>());
  const emitLabelPrint = (event: LabelPrintEvent) => {
    for (const listener of labelPrintListenersRef.current) listener(event);
  };
  // 緊急が取り消されたと知らせが来たら、この端末に残っているそのシールを消す（どの画面を開いていても）
  const ws = useOrdersWS({
    onCupEmergencyCancelled: (id) => {
      cancelPendingPrint(id);
      emitLabelPrint({ type: "cancelled", id });
    },
    onOrderRecalled: (orderId) => {
      for (const listener of recallListenersRef.current) listener(orderId);
    },
    onLabelPrintRequested: (request) =>
      emitLabelPrint({ type: "requested", request }),
    onLabelPrintDone: (id) => {
      completePendingPrint(id);
      emitLabelPrint({ type: "done", id });
    },
    // 営業データが消されたら、手元に持っている注文や受付の状態を捨てるために読み込み直す。
    // 消した画面（データのリセット）だけは、消した結果を見せたいので読み込み直さない
    onDataReset: () => {
      if (window.location.pathname !== DATA_RESET_PATH)
        window.location.reload();
    },
  });
  const subscribeRecall = useCallback(
    (listener: RecallListener) =>
      addListener(recallListenersRef.current, listener),
    [],
  );
  const subscribeLabelPrints = useCallback(
    (listener: LabelPrintListener) =>
      addListener(labelPrintListenersRef.current, listener),
    [],
  );
  const value = { ...ws, subscribeRecall, subscribeLabelPrints };

  return (
    <OrdersWSContext.Provider value={value}>
      {children}
    </OrdersWSContext.Provider>
  );
};

export const useOrdersWSContext = () => {
  const context = useContext(OrdersWSContext);
  if (!context) {
    throw new Error("useOrdersWSContext must be used within OrdersWSProvider");
  }
  return context;
};

/** 呼び出し催促の知らせ（注文の id）を受けるたびに onRecall を呼ぶ。呼び出し画面が読み上げに使う */
export const useOrderRecalled = (onRecall: RecallListener) => {
  const { subscribeRecall } = useOrdersWSContext();
  useEffect(() => subscribeRecall(onRecall), [subscribeRecall, onRecall]);
};

/** 代理印刷の知らせを受けるたびに onEvent を呼ぶ（label/print-relay の useLabelPrintQueue が使う） */
export const useLabelPrintEvents = (onEvent: LabelPrintListener) => {
  const { subscribeLabelPrints } = useOrdersWSContext();
  useEffect(
    () => subscribeLabelPrints(onEvent),
    [subscribeLabelPrints, onEvent],
  );
};
