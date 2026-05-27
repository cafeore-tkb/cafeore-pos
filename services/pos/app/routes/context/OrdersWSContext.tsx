import { type OrderEntity, type WithId, useOrdersWS } from "@cafeore/common";
// context/OrdersWSContext.tsx
import { createContext, useContext } from "react";
import { isPreviewMockEnabled } from "~/lib/preview/previewMode";
import { usePreviewOrders } from "~/lib/preview/usePreviewOrders";

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
  const previewMockEnabled = isPreviewMockEnabled();
  const wsValue = useOrdersWS();
  const previewOrders = usePreviewOrders();
  const value = previewMockEnabled
    ? { orders: previewOrders, status: "open" as const }
    : wsValue;

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
