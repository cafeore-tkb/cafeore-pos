import {
  type OrderEntity,
  type SquareCheckout,
  SquareCheckoutConflictError,
  type SquarePaymentType,
  squareRepository,
} from "@cafeore/common";
import { useCallback, useEffect, useRef, useState } from "react";

/** 端末の状態を問い合わせる間隔 */
const POLL_INTERVAL_MS = 1500;

export type SquarePaymentPhase =
  /** 端末に決済画面を出すよう依頼している */
  | "creating"
  /** お客さんの操作を待っている */
  | "waiting"
  /** 取り消しを依頼した。端末が応じるのを待っている */
  | "canceling"
  /** 支払い済み。注文をまだ送れていない（通信が切れているなど） */
  | "paid"
  /** 取り消された・失敗した。お金は受け取っていない */
  | "failed"
  /** 受取額が合わないなど、人が Square の管理画面で確かめる必要がある */
  | "attention"
  /** 別の決済が進行中で、新しく出せなかった */
  | "conflict";

export type SquarePaymentState = {
  phase: SquarePaymentPhase;
  paymentType: SquarePaymentType;
  idempotencyKey: string;
  /** 決済を始めた時点の注文。支払い中に画面の注文が変わっても、これを送る */
  order: OrderEntity;
  checkout: SquareCheckout | null;
  /** 進行中だった別の決済（phase が conflict のとき） */
  conflicting: SquareCheckout | null;
  message: string | null;
};

type Options = {
  /**
   * 支払いが確定したときに呼ぶ。注文を送れたら true を返す（ダイアログを閉じる）。
   * false なら phase を paid にして、手で送り直せるようにする。
   */
  onPaid: (checkout: SquareCheckout, order: OrderEntity) => boolean;
};

const cancelMessage = (checkout: SquareCheckout): string => {
  switch (checkout.cancel_reason) {
    case "BUYER_CANCELED":
      return "端末で取り消されました";
    case "SELLER_CANCELED":
      return "レジから取り消しました";
    case "TIMED_OUT":
      return "時間切れで取り消されました（5分）";
    default:
      return checkout.error_message ?? "決済できませんでした";
  }
};

/**
 * Square Terminal での決済を進める
 *
 * 決済が先・注文が後。start で端末に決済画面を出し、完了するまで問い合わせ続け、
 * 支払いが確定したら onPaid に注文を渡す。
 */
export const useSquarePayment = ({ onPaid }: Options) => {
  const [state, setState] = useState<SquarePaymentState | null>(null);
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  // 状態が決まった決済依頼を画面の状態に反映する
  const applyCheckout = useCallback((checkout: SquareCheckout) => {
    setState((prev) => {
      if (prev === null || prev.checkout?.id !== checkout.id) {
        return prev;
      }
      switch (checkout.outcome) {
        case "pending":
          return { ...prev, checkout };
        case "failed":
          return {
            ...prev,
            checkout,
            phase: "failed",
            message: cancelMessage(checkout),
          };
        case "attention":
          return {
            ...prev,
            checkout,
            phase: "attention",
            message: `受け取った額（${checkout.paid_amount ?? "不明"} 円）が請求額（${checkout.amount} 円）と合いません。Square の管理画面で確かめてください`,
          };
        case "paid":
          return { ...prev, checkout, phase: "paid", message: null };
      }
    });
  }, []);

  // 支払いが確定したら注文を送る。setState の外で呼ぶ（送信は副作用なので）。
  const settledRef = useRef<string | null>(null);
  useEffect(() => {
    if (state?.phase !== "paid" || state.checkout === null) {
      return;
    }
    if (settledRef.current === state.checkout.id) {
      return;
    }
    settledRef.current = state.checkout.id;
    if (onPaidRef.current(state.checkout, state.order)) {
      setState(null);
    }
  }, [state]);

  const create = useCallback(
    async (base: SquarePaymentState) => {
      setState({ ...base, phase: "creating", message: null });
      try {
        const checkout = await squareRepository.createCheckout({
          idempotencyKey: base.idempotencyKey,
          amount: base.order.billingAmount,
          paymentType: base.paymentType,
          orderNumber: base.order.orderId,
        });
        setState((prev) =>
          prev?.idempotencyKey === base.idempotencyKey
            ? { ...prev, checkout, phase: "waiting" }
            : prev,
        );
        applyCheckout(checkout);
      } catch (error) {
        if (error instanceof SquareCheckoutConflictError) {
          setState((prev) =>
            prev?.idempotencyKey === base.idempotencyKey
              ? {
                  ...prev,
                  phase: "conflict",
                  conflicting: error.checkout,
                  message: error.message,
                }
              : prev,
          );
          return;
        }
        // 通信エラーなど。同じ idempotencyKey で送り直せば二重にはならない。
        setState((prev) =>
          prev?.idempotencyKey === base.idempotencyKey
            ? {
                ...prev,
                phase: "failed",
                message: `端末に送れませんでした: ${error instanceof Error ? error.message : String(error)}`,
              }
            : prev,
        );
      }
    },
    [applyCheckout],
  );

  /** 端末に決済画面を出す */
  const start = useCallback(
    (order: OrderEntity, paymentType: SquarePaymentType) => {
      if (state !== null) {
        return;
      }
      void create({
        phase: "creating",
        paymentType,
        idempotencyKey: crypto.randomUUID(),
        order: order.clone(),
        checkout: null,
        conflicting: null,
        message: null,
      });
    },
    [state, create],
  );

  /** 端末に届かなかったとき、同じ依頼を送り直す */
  const retry = useCallback(() => {
    if (state === null || state.checkout !== null) {
      return;
    }
    void create(state);
  }, [state, create]);

  /** 進行中の決済を取り消す */
  const cancel = useCallback(async () => {
    const target = state?.checkout;
    if (!target) {
      return;
    }
    setState((prev) =>
      prev === null ? prev : { ...prev, phase: "canceling", message: null },
    );
    try {
      applyCheckout(await squareRepository.cancelCheckout(target.id));
    } catch (error) {
      if (error instanceof SquareCheckoutConflictError) {
        // 既に支払われていた・電子マネーで端末にエラーが出ているなど
        setState((prev) =>
          prev === null
            ? prev
            : { ...prev, phase: "waiting", message: error.message },
        );
        applyCheckout(error.checkout);
        return;
      }
      setState((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              phase: "waiting",
              message: `取り消せませんでした: ${error instanceof Error ? error.message : String(error)}`,
            },
      );
    }
  }, [state, applyCheckout]);

  /** 進行中だった別の決済を取り消す（phase が conflict のとき） */
  const cancelConflicting = useCallback(async () => {
    const target = state?.conflicting;
    if (!target) {
      return;
    }
    try {
      const canceled = await squareRepository.cancelCheckout(target.id);
      setState((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              conflicting: canceled,
              message:
                canceled.outcome === "failed"
                  ? "進行中の決済を取り消しました。もう一度お試しください"
                  : "取り消しを依頼しました。端末の画面を確認してください",
            },
      );
    } catch (error) {
      setState((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              message: `取り消せませんでした: ${error instanceof Error ? error.message : String(error)}`,
            },
      );
    }
  }, [state]);

  /** 支払い済みの注文を送り直す（phase が paid のとき） */
  const submitPaid = useCallback(() => {
    if (state?.phase !== "paid" || state.checkout === null) {
      return;
    }
    if (onPaidRef.current(state.checkout, state.order)) {
      setState(null);
    }
  }, [state]);

  /**
   * ダイアログを閉じる。お金を受け取っていない・人が確かめる・結果がいつまでも
   * 決まらない、のどれかのときだけ（どれに当たるかはダイアログが判断する）
   */
  const close = useCallback(() => {
    setState((prev) => (prev !== null && prev.phase !== "paid" ? null : prev));
  }, []);

  // 結果が決まるまで問い合わせ続ける
  const checkoutId = state?.checkout?.id;
  const polling =
    checkoutId !== undefined &&
    (state?.phase === "waiting" || state?.phase === "canceling");
  useEffect(() => {
    if (!polling || checkoutId === undefined) {
      return;
    }
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const checkout = await squareRepository.getCheckout(checkoutId);
        if (!stopped) {
          applyCheckout(checkout);
        }
      } catch (error) {
        // 一時的な通信エラーは次の問い合わせで回復する
        console.error(error);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [polling, checkoutId, applyCheckout]);

  return {
    state,
    active: state !== null,
    start,
    retry,
    cancel,
    cancelConflicting,
    submitPaid,
    close,
  };
};
