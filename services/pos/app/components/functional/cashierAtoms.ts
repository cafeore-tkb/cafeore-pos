import type { OrderEntity } from "@cafeore/common";
import { atom } from "jotai";
import {
  type CashierDraft,
  activeMenus,
  emptyCashierDraft,
} from "./cashierDraft";
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
 * UI state: 入力中の注文の下書き（削除した行・引換券番号・受取金額・段階など）
 */
const cashierDraftAtom = atom<CashierDraft>(emptyCashierDraft());

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

type UpdateCashierDraftPayload = {
  update: (draft: CashierDraft) => CashierDraft;
  syncOrder?: SyncOrder;
};

/**
 * Side-effect bridge: update the draft, then copy its items (without voided lines)
 * and received amount to the editing order and sync it.
 */
const updateCashierDraftAtom = atom(
  null,
  (get, set, payload: UpdateCashierDraftPayload) => {
    const prev = get(cashierDraftAtom);
    const next = payload.update(prev);
    if (next === prev) {
      return;
    }
    set(cashierDraftAtom, next);
    const actions: OrderAction[] = [];
    if (next.lines !== prev.lines) {
      actions.push({ type: "setMenus", menus: activeMenus(next) });
    }
    if (next.received !== prev.received) {
      actions.push({ type: "setReceived", received: next.received });
    }
    if (actions.length === 0) {
      return;
    }
    const order = actions.reduce(
      (current, action) => applyOrderAction.reduce(current, action),
      get(editingOrderAtom),
    );
    set(editingOrderAtom, order);
    payload.syncOrder?.(order);
  },
);

export {
  applyCashierOrderActionAtom,
  cashierDraftAtom,
  editingOrderAtom,
  updateCashierDraftAtom,
};
