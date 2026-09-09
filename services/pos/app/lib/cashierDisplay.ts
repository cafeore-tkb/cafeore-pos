import type { Order } from "@cafeore/common";

/**
 * レジ画面 (/cashier) から客用画面 (/cashier-mini) へ表示内容を配信するチャンネル
 *
 * BroadcastChannel は同一ブラウザの同一オリジン間でしか届かないため、
 * 客用画面はレジのパソコンにつないだモニタで開く必要がある
 */
const CHANNEL_NAME = "cafeore-cashier-display";

/** 客用画面に表示する内容 */
export type CashierDisplayState = {
  /** レジで入力中のオーダー */
  edittingOrder: Order;
  /** 確定したオーダー 入力中は null */
  submittedOrder: Order | null;
};

export type CashierDisplayMessage =
  /** レジ画面が表示内容を配信する */
  | { type: "publish"; state: CashierDisplayState }
  /** 客用画面が最新の表示内容を要求する（画面を開いた直後） */
  | { type: "request" };

export const openCashierDisplayChannel = () =>
  new BroadcastChannel(CHANNEL_NAME);
