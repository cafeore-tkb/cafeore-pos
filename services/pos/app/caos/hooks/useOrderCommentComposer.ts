import {
  type OrderComment,
  type OrderEntity,
  type WithId,
  caosDayOrders,
  jstDate,
} from "@cafeore/common";
import { useEffect, useMemo, useReducer } from "react";
import {
  commentComposerHistory,
  commentComposerReducer,
  emptyCommentComposer,
} from "../logic/orderCommentComposer";

/** パネルの開閉や別のパネルへの切り替えで、宛先と注文別の下書きを失わない。下書きは最終編集から約3分で消し、再読込・日付変更・練習開始でもリセット。 */
export function useOrderCommentComposer(
  orders: readonly WithId<OrderEntity>[],
  nowMs: number,
  enabled: boolean,
) {
  const day = jstDate(nowMs);
  const [stored, dispatch] = useReducer(
    commentComposerReducer,
    day,
    emptyCommentComposer,
  );
  const state =
    stored.day === day && enabled ? stored : emptyCommentComposer(day);
  useEffect(() => {
    if (stored.day !== day || !enabled) dispatch({ type: "reset", day });
  }, [day, enabled, stored.day]);
  useEffect(() => {
    const timer = window.setInterval(
      () => dispatch({ type: "expire", now: Date.now() }),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const today = useMemo(
    () =>
      caosDayOrders(orders, day)
        .filter((order) => !order.isCancelled())
        .sort((a, b) => b.orderId - a.orderId),
    [orders, day],
  );
  const target = today.find((order) => order.id === state.targetId);
  return {
    state,
    today,
    target,
    draft: target ? (state.drafts[target.id]?.text ?? "") : "",
    history: target
      ? commentComposerHistory(target, state.confirmed[target.id] ?? [])
      : [],
    choose: (order: WithId<OrderEntity>) =>
      dispatch({ type: "choose", id: order.id, orderNo: order.orderId }),
    change: () => dispatch({ type: "change" }),
    setDigits: (value: string) => dispatch({ type: "digits", value }),
    setDraft: (id: string, text: string) =>
      dispatch({ type: "draft", id, text, editedAt: Date.now() }),
    recordSent: (id: string, comment: OrderComment) =>
      dispatch({ type: "confirmed", id, comment }),
    sentDraft: (id: string, text: string) =>
      dispatch({ type: "sentDraft", id, text }),
  };
}
