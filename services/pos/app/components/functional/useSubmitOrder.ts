import type { OrderEntity, WithId } from "@cafeore/common";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

const SUBMIT_FAILED_TOAST_ID = "cashier-submit-failed";

/**
 * 保存した注文を返す。失敗したら reject する
 *
 * idempotencyKey が同じなら、保存済みでも新しく作らずにその注文を返す
 */
type SubmitPayload = (
  order: OrderEntity,
  idempotencyKey: string | undefined,
) => Promise<WithId<OrderEntity>>;

/**
 * レジの注文を保存する
 *
 * - 保存中は二重に送らない。`submittingRef` は同じ描画のうちのキー入力を止めるため
 * - 失敗したら知らせて `undefined` を返す。知らせは見落とさないよう、閉じるか次に保存できるまで出し続ける
 * - 応答が届かずに失敗扱いになっても、サーバー側では保存できていることがある。
 *   同じ内容のまま送り直せば同じキーを付け、サーバーは新しく作らずに保存済みの注文を返す。
 *   内容を変えたら別の注文として新しいキーにする。入力を消したら `resetKey` する
 */
const useSubmitOrder = (submitPayload: SubmitPayload) => {
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const lastKey = useRef<{ content: string; key: string | undefined } | null>(
    null,
  );

  const submit = useCallback(
    async (order: OrderEntity) => {
      if (submittingRef.current) {
        return;
      }
      const content = orderContent(order);
      if (lastKey.current?.content !== content) {
        lastKey.current = { content, key: newKey() };
      }
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const savedOrder = await submitPayload(order, lastKey.current.key);
        toast.dismiss(SUBMIT_FAILED_TOAST_ID);
        return savedOrder;
      } catch (error) {
        console.error(error);
        const reason = error instanceof Error ? error.message : String(error);
        toast.error(`No.${order.orderId} の注文を保存できませんでした`, {
          id: SUBMIT_FAILED_TOAST_ID,
          description: `ラベルは印刷していません。入力はそのまま残っています。入力を変えずにもう一度送信してください。応答が届かなかっただけで保存できていた場合も、二重には登録されません（${reason}）`,
          duration: Number.POSITIVE_INFINITY,
          closeButton: true,
          richColors: true,
        });
      } finally {
        submittingRef.current = false;
        setSubmitting(false);
      }
    },
    [submitPayload],
  );

  const resetKey = useCallback(() => {
    lastKey.current = null;
  }, []);

  return { submit, submitting, submittingRef, resetKey };
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

export { useSubmitOrder, type SubmitPayload };
