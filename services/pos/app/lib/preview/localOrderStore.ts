import { type Order, OrderEntity, type WithId } from "@cafeore/common";

export const PREVIEW_ORDERS_KEY = "pos-preview-orders-v1";
const PREVIEW_EDITING_ORDER_KEY = "pos-preview-editing-order-v1";
export const PREVIEW_ORDERS_UPDATED_EVENT = "pos-preview-orders-updated";

const isBrowser = () => typeof window !== "undefined";

const sanitizeOrderForLocalStorage = (order: Order): Order => {
  return {
    ...order,
    // Avoid persisting sensitive payment information in cleartext localStorage.
    billingAmount: 0,
    received: 0,
  };
};

const generateId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `preview-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const reviveOrder = (order: Order): Order => {
  return {
    ...order,
    createdAt: new Date(order.createdAt),
    readyAt: order.readyAt ? new Date(order.readyAt) : null,
    servedAt: order.servedAt ? new Date(order.servedAt) : null,
    comments: order.comments.map((comment) => ({
      ...comment,
      createdAt: new Date(comment.createdAt),
    })),
  };
};

const notifyPreviewOrdersUpdated = () => {
  if (!isBrowser()) {
    return;
  }
  window.dispatchEvent(new Event(PREVIEW_ORDERS_UPDATED_EVENT));
};

const readOrders = (): WithId<OrderEntity>[] => {
  if (!isBrowser()) {
    return [];
  }
  const raw = window.localStorage.getItem(PREVIEW_ORDERS_KEY);
  if (raw == null) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Order[];
    return parsed.map((order) =>
      OrderEntity.fromOrder(reviveOrder(order)),
    ) as WithId<OrderEntity>[];
  } catch (error) {
    console.warn("Failed to parse preview orders", error);
    return [];
  }
};

const writeOrders = (orders: WithId<OrderEntity>[]) => {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.setItem(
    PREVIEW_ORDERS_KEY,
    JSON.stringify(
      orders.map((order) => sanitizeOrderForLocalStorage(order.toOrder())),
    ),
  );
  notifyPreviewOrdersUpdated();
};

export const getPreviewOrders = (): WithId<OrderEntity>[] => {
  return readOrders();
};

export const savePreviewSubmittedOrder = (
  order: OrderEntity,
): WithId<OrderEntity> => {
  const currentOrders = readOrders();
  const normalized = order.toOrder();
  const id = normalized.id ?? generateId();
  const withId = OrderEntity.fromOrder({
    ...normalized,
    id,
  }) as WithId<OrderEntity>;
  const nextOrders = [
    ...currentOrders.filter((v) => v.id !== withId.id),
    withId,
  ].sort((a, b) => a.orderId - b.orderId);
  writeOrders(nextOrders);
  return withId;
};

export const syncPreviewEditingOrder = (order: OrderEntity) => {
  if (!isBrowser()) {
    return;
  }
  window.localStorage.setItem(
    PREVIEW_EDITING_ORDER_KEY,
    JSON.stringify(sanitizeOrderForLocalStorage(order.toOrder())),
  );
};
