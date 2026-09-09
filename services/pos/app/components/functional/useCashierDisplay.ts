import { OrderEntity } from "@cafeore/common";
import { useEffect, useMemo, useState } from "react";
import {
  type CashierDisplayMessage,
  type CashierDisplayState,
  openCashierDisplayChannel,
} from "~/lib/cashierDisplay";

export type CashierDisplay = {
  edittingOrder: OrderEntity;
  submittedOrder: OrderEntity | null;
};

/**
 * レジ画面 (/cashier) が配信している表示内容を受け取るフック
 *
 * 同じブラウザでレジ画面が開かれていない間は null を返す
 * @returns 表示内容
 */
export const useCashierDisplay = (): CashierDisplay | null => {
  const [state, setState] = useState<CashierDisplayState | null>(null);

  /**
   * OK
   */
  useEffect(() => {
    const channel = openCashierDisplayChannel();
    channel.onmessage = (event: MessageEvent<CashierDisplayMessage>) => {
      if (event.data.type === "publish") {
        setState(event.data.state);
      }
    };
    // 画面を開いた直後は配信を受け取れていないため、レジ画面に現在の状態を要求する
    channel.postMessage({ type: "request" } satisfies CashierDisplayMessage);
    return () => {
      channel.close();
    };
  }, []);

  return useMemo(() => {
    if (state == null) {
      return null;
    }
    return {
      edittingOrder: OrderEntity.fromOrder(state.edittingOrder),
      submittedOrder:
        state.submittedOrder == null
          ? null
          : OrderEntity.fromOrder(state.submittedOrder),
    };
  }, [state]);
};
