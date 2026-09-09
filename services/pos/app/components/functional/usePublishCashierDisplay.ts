import type { OrderEntity } from "@cafeore/common";
import { useCallback, useEffect, useRef } from "react";
import {
  type CashierDisplayMessage,
  type CashierDisplayState,
  openCashierDisplayChannel,
} from "~/lib/cashierDisplay";

const postState = (channel: BroadcastChannel, state: CashierDisplayState) => {
  channel.postMessage({
    type: "publish",
    state,
  } satisfies CashierDisplayMessage);
};

/**
 * 客用画面 (/cashier-mini) に表示する内容を配信するフック
 *
 * Entity はメソッドを持ち構造化複製できないため、Order に変換してから送る
 */
export const usePublishCashierDisplay = () => {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const stateRef = useRef<CashierDisplayState | null>(null);

  const publish = useCallback((state: CashierDisplayState) => {
    stateRef.current = state;
    const channel = channelRef.current;
    if (channel != null) {
      postState(channel, state);
    }
  }, []);

  /**
   * OK
   */
  useEffect(() => {
    const channel = openCashierDisplayChannel();
    channelRef.current = channel;
    channel.onmessage = (event: MessageEvent<CashierDisplayMessage>) => {
      // 客用画面を開き直したときのために、要求されたら最新の状態を送り直す
      const state = stateRef.current;
      if (event.data.type === "request" && state != null) {
        postState(channel, state);
      }
    };
    // 子コンポーネントの effect が先に実行されるため、
    // チャンネルの開通前に配信された状態を取りこぼしうる
    if (stateRef.current != null) {
      postState(channel, stateRef.current);
    }
    return () => {
      channelRef.current = null;
      channel.close();
    };
  }, []);

  const publishEdittingOrder = useCallback(
    (order: OrderEntity) => {
      // オーダーの確定直後はリセットされた空のオーダーが流れてくるが、
      // それによって確定済みの表示を消さないようにする
      if (
        stateRef.current?.submittedOrder != null &&
        order.items.length === 0
      ) {
        return;
      }
      publish({ edittingOrder: order.toOrder(), submittedOrder: null });
    },
    [publish],
  );

  const publishSubmittedOrder = useCallback(
    (order: OrderEntity) => {
      const submittedOrder = order.toOrder();
      publish({ edittingOrder: submittedOrder, submittedOrder });
    },
    [publish],
  );

  return { publishEdittingOrder, publishSubmittedOrder };
};
