import { type ItemEntity, OrderEntity, type WithId } from "@cafeore/common";
import { useReducer } from "react";

type BaseAction<TypeName extends string> = { type: TypeName };
type Action<
  TypeName extends string,
  U extends { [K in keyof U]: K extends "type" ? never : unknown } = Record<
    never,
    never
  >,
> = BaseAction<TypeName> & U;

type Clear = Action<"clear", { effectFn?: () => void }>;
type UpdateOrderId = Action<"updateOrderId", { orderId: number }>;
type AddItem = Action<"addItem", { item: WithId<ItemEntity> }>;
type RemoveItem = Action<"removeItem", { idx: number }>;
type MutateItem = Action<
  "mutateItem",
  { idx: number; action: (prev: WithId<ItemEntity>) => WithId<ItemEntity> }
>;
type ApplyDiscount = Action<
  "applyDiscount",
  { discountOrder: WithId<OrderEntity> }
>;
type RemoveDiscount = Action<"removeDiscount">;
type SetReceived = Action<"setReceived", { received: string }>;

/**
 * オーダーの状態を更新するためのアクション型
 */
export type OrderAction =
  | Clear
  | UpdateOrderId
  | AddItem
  | RemoveItem
  | MutateItem
  | ApplyDiscount
  | RemoveDiscount
  | SetReceived;

type OrderReducer<T extends OrderAction> = (
  state: OrderEntity,
  action: T,
) => OrderEntity;

const clear: OrderReducer<Clear> = (state, action) => {
  const effectFn = action.effectFn;
  if (effectFn) {
    effectFn();
  }
  return OrderEntity.createNew({ orderId: state.orderId });
};

const updateOrderId: OrderReducer<UpdateOrderId> = (state, action) => {
  const updated = state.clone();
  updated.orderId = action.orderId;
  return updated;
};

const addItem: OrderReducer<AddItem> = (state, action) => {
  const updated = state.clone();
  updated.items = [...updated.items, action.item];
  return updated;
};

const removeItem: OrderReducer<RemoveItem> = (state, action) => {
  const updated = state.clone();
  updated.items = updated.items.filter((_, idx) => idx !== action.idx);
  return updated;
};

const mutateItem: OrderReducer<MutateItem> = (state, action) => {
  const updated = state.clone();
  updated.items[action.idx] = action.action(updated.items[action.idx]);
  return updated;
};

const applyDiscount: OrderReducer<ApplyDiscount> = (state, action) => {
  const updated = state.clone();
  updated.applyDiscount(action.discountOrder);
  return updated;
};

const removeDiscount: OrderReducer<RemoveDiscount> = (state, action) => {
  const updated = state.clone();
  updated.removeDiscount();
  return updated;
};

const setReceived: OrderReducer<SetReceived> = (state, action) => {
  const updated = state.clone();
  updated.received = Number(action.received);
  return updated;
};

const reducer: OrderReducer<OrderAction> = (state, action): OrderEntity => {
  switch (action.type) {
    case "clear":
      return clear(state, action);
    case "applyDiscount":
      return applyDiscount(state, action);
    case "removeDiscount":
      return removeDiscount(state, action);
    case "addItem":
      return addItem(state, action);
    case "removeItem":
      return removeItem(state, action);
    case "mutateItem":
      return mutateItem(state, action);
    case "setReceived":
      return setReceived(state, action);
    case "updateOrderId":
      return updateOrderId(state, action);
  }
};

/**
 * オーダーの状態を管理する
 *
 * @returns オーダーの状態とそれを更新する関数
 */
const useOrderState = () =>
  useReducer(reducer, OrderEntity.createNew({ orderId: -1 }));

export { useOrderState };
