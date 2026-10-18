import { useOrdersWS } from "@cafeore/common";
// context/OrdersWSContext.tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { cancelPendingPrint } from "~/label/pending-prints";

type RecallListener = (orderId: string) => void;

type OrdersWSContextValue = ReturnType<typeof useOrdersWS> & {
  /** 呼び出し催促の知らせを受け取る関数を足す。外す関数を返す（useOrderRecalled から使う） */
  subscribeRecall: (listener: RecallListener) => () => void;
};

const OrdersWSContext = createContext<OrdersWSContextValue | null>(null);

export const OrdersWSProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  // 呼び出し催促は状態ではなく 1 回ずつの知らせなので、受け取りたい画面（useOrderRecalled）にそのまま渡す
  const recallListenersRef = useRef(new Set<RecallListener>());
  // 緊急が取り消されたと知らせが来たら、この端末に残っているそのシールを消す（どの画面を開いていても）
  const ws = useOrdersWS({
    onCupEmergencyCancelled: cancelPendingPrint,
    onOrderRecalled: (orderId) => {
      for (const listener of recallListenersRef.current) listener(orderId);
    },
  });
  const subscribeRecall = useCallback((listener: RecallListener) => {
    const listeners = recallListenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  const value = { ...ws, subscribeRecall };

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
