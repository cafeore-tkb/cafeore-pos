import type { OrderEntity, WithId } from "@cafeore/common";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

const SUBMIT_FAILED_TOAST_ID = "cashier-submit-failed";
const SAVED_EARLIER_TOAST_ID = "cashier-saved-earlier";

/**
 * 保存した注文を返す。失敗したら reject する
 *
 * idempotencyKey が同じなら、保存済みでも新しく作らずにその注文を返す
 */
type SubmitPayload = (
  order: OrderEntity,
  idempotencyKey: string | undefined,
) => Promise<WithId<OrderEntity>>;

type SubmitResult = {
  savedOrder: WithId<OrderEntity>;
  /** 前に送って応答が届かなかった内容が保存されていて、今の内容は保存していない */
  savedEarlierContent: boolean;
};

/**
 * レジの注文を保存する
 *
 * - 保存中は二重に送らない。`submittingRef` は同じ描画のうちのキー入力を止めるため
 * - 失敗したら知らせて `undefined` を返す。知らせは見落とさないよう、閉じるか次に保存できるまで出し続ける
 * - 応答が届かずに失敗扱いになっても、サーバー側では保存できていることがある。
 *   保存できたと確かめられるまでは、内容を変えても入力を消しても再読み込みしても同じキーで送る。
 *   前の送信が保存されていれば、サーバーは新しく作らずにその注文を返すので二重にならない。
 *   そのとき返った注文が今の内容と違えば `savedEarlierContent` で知らせる
 */
const useSubmitOrder = (submitPayload: SubmitPayload) => {
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  const submit = useCallback(
    async (order: OrderEntity): Promise<SubmitResult | undefined> => {
      if (submittingRef.current) {
        return;
      }
      const unconfirmedKey = loadUnconfirmedKey();
      const key = unconfirmedKey ?? newKey();
      saveUnconfirmedKey(key);
      submittingRef.current = true;
      setSubmitting(true);
      try {
        const savedOrder = await submitPayload(order, key);
        saveUnconfirmedKey(undefined);
        toast.dismiss(SUBMIT_FAILED_TOAST_ID);
        const savedEarlierContent =
          unconfirmedKey !== undefined &&
          orderContent(savedOrder) !== orderContent(order);
        if (savedEarlierContent) {
          toast.warning(
            `No.${savedOrder.orderId} は前に送った内容で保存されていました`,
            {
              id: SAVED_EARLIER_TOAST_ID,
              description:
                "応答が届かなかった送信が保存できていたので、新しくは登録していません。ラベルは保存された内容で印刷しました。前の注文を直すときは注文の修正から、別の注文なら入力し直して送信してください",
              duration: Number.POSITIVE_INFINITY,
              closeButton: true,
              richColors: true,
            },
          );
        }
        return { savedOrder, savedEarlierContent };
      } catch (error) {
        console.error(error);
        const reason = error instanceof Error ? error.message : String(error);
        toast.error(`No.${order.orderId} の注文を保存できませんでした`, {
          id: SUBMIT_FAILED_TOAST_ID,
          description: `ラベルは印刷していません。入力はそのまま残っています。もう一度送信してください。応答が届かなかっただけで保存できていた場合も、二重には登録されません（${reason}）`,
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

  return { submit, submitting, submittingRef };
};

// randomUUID は https か localhost でしか使えない。使えないときはキーを付けず、今までどおり保存する
const newKey = () =>
  typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : undefined;

// 保存できたと確かめられていないキー。再読み込みしても同じキーで送り直せるよう、タブごとに覚えておく
const UNCONFIRMED_KEY_STORAGE = "cashier-unconfirmed-order-key";

const loadUnconfirmedKey = () => {
  try {
    return sessionStorage.getItem(UNCONFIRMED_KEY_STORAGE) ?? undefined;
  } catch {
    return undefined;
  }
};

const saveUnconfirmedKey = (key: string | undefined) => {
  try {
    if (key === undefined) {
      sessionStorage.removeItem(UNCONFIRMED_KEY_STORAGE);
    } else {
      sessionStorage.setItem(UNCONFIRMED_KEY_STORAGE, key);
    }
  } catch {
    // 覚えておけないときは、再読み込みでキーが変わるだけ
  }
};

/**
 * 返った注文が送った内容と同じかを見分けるための内容
 *
 * 注文番号は、遅れて保存された注文の分だけ進むことがあるので含めない。
 * 時刻は送信のたびに付け直すので含めない。サーバーは品物や備考の並びを保たないので並べ替える
 */
const orderContent = (order: OrderEntity) =>
  JSON.stringify([
    order.menus.map((menu) => JSON.stringify([menu.id, menu.assignee])).sort(),
    order.billingAmount,
    order.received,
    order.discountOrderId,
    order.discountOrderCups,
    order.comments
      .map((comment) => JSON.stringify([comment.author, comment.text]))
      .sort(),
  ]);

export { useSubmitOrder, type SubmitPayload };
