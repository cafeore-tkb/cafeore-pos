import { useOrdersWS } from "@cafeore/common";
// context/OrdersWSContext.tsx
import { createContext, useContext } from "react";
import { cancelPendingPrint } from "~/label/pending-prints";

type OrdersWSContextValue = ReturnType<typeof useOrdersWS>;

const OrdersWSContext = createContext<OrdersWSContextValue | null>(null);

export const OrdersWSProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  // 緊急が取り消されたと知らせが来たら、この端末に残っているそのシールを消す（どの画面を開いていても）
  const value = useOrdersWS({ onCupEmergencyCancelled: cancelPendingPrint });

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
