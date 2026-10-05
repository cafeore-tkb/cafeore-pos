import type { OrderEntity } from "@cafeore/common";
import { atom } from "jotai";
import { type OrderAction, applyOrderAction } from "./useOrderState";

type SyncOrder = (order: OrderEntity) => void;

type ApplyCashierOrderActionPayload = {
  action: OrderAction;
  syncOrder?: SyncOrder;
};

/**
 * Domain state: cashier editing order.
 */
const editingOrderAtom = atom(applyOrderAction.initialState());

/**
 * Side-effect bridge: apply order action and immediately sync.
 */
const applyCashierOrderActionAtom = atom(
  null,
  (get, set, payload: ApplyCashierOrderActionPayload) => {
    const current = get(editingOrderAtom);
    const next = applyOrderAction.reduce(current, payload.action);
    set(editingOrderAtom, next);
    payload.syncOrder?.(next);
  },
);

export { applyCashierOrderActionAtom, editingOrderAtom };
