import { type OrderEntity, type WithId, useOrdersWS } from "@cafeore/common";
// context/OrdersWSContext.tsx
import { createContext, useContext } from "react";

type WsStatus = "connecting" | "open" | "closed" | "error";

type OrdersWSContextValue = {
  orders: WithId<OrderEntity>[];
  status: WsStatus;
};

const OrdersWSContext = createContext<OrdersWSContextValue | null>(null);

export const OrdersWSProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const value = useOrdersWS();

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
