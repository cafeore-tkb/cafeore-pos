import type { OrderEntity } from "@cafeore/common";
import { useCallback, useRef } from "react";

/**
 * 送り直したときに注文が二重にできないよう、注文の保存に付けるキーを払い出す
 *
 * 応答が届かずに失敗扱いになっても、サーバー側では保存できていることがある。
 * 同じ内容のまま送り直せば同じキーになり、サーバーは新しく作らずに保存済みの注文を返す。
 * 内容を変えたら別の注文として新しいキーにする。保存できたら `reset` する
 */
const useSubmitKey = () => {
  const current = useRef<{ content: string; key: string | undefined } | null>(
    null,
  );

  const keyFor = useCallback((order: OrderEntity) => {
    const content = orderContent(order);
    if (current.current?.content !== content) {
      current.current = { content, key: newKey() };
    }
    return current.current.key;
  }, []);

  const reset = useCallback(() => {
    current.current = null;
  }, []);

  return { keyFor, reset };
};

// randomUUID は https か localhost でしか使えない。使えないときはキーを付けず、今までどおり保存する
const newKey = () =>
  typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : undefined;

/**
 * 送り直しで同じ注文かどうかを見分けるための内容
 *
 * 注文番号は、遅れて保存された注文の分だけ進むことがあるので含めない。
 * 時刻は送信のたびに付け直すので含めない
 */
const orderContent = (order: OrderEntity) =>
  JSON.stringify([
    order.menus.map((menu) => [menu.id, menu.assignee]),
    order.billingAmount,
    order.received,
    order.discountOrderId,
    order.discountOrderCups,
    order.comments.map((comment) => [comment.author, comment.text]),
  ]);

export { useSubmitKey };
