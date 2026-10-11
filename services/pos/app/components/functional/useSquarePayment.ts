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
  /** 支払い済み。注文を送って、登録できたかを待っている */
  | "submitting"
  /** 取り消された・失敗した。お金は受け取っていない */
  | "failed"
  /** 受取額が合わないなど、人が Square の管理画面で確かめる必要がある */
  | "attention"
  /** 別の決済が進行中で、新しく出せなかった */
  | "conflict";

export type SquarePaymentState = {
  phase: SquarePaymentPhase;
  paymentType: SquarePaymentType;
  /** 決済画面を出す端末。支払い中にレジの端末を選び直しても、これに出す */
  deviceId: string;
  idempotencyKey: string;
  /** 決済を始めた時点の注文。支払い中に画面の注文が変わっても、これを送る */
  order: OrderEntity;
  checkout: SquareCheckout | null;
  /** 端末に決済画面を出せた（onStarted を呼んだ） */
  started: boolean;
  /** 進行中だった別の決済（phase が conflict のとき） */
  conflicting: SquareCheckout | null;
  message: string | null;
};

type Options = {
  /**
   * 端末に決済画面が出たときに 1 回だけ呼ぶ。支払いを待つ間にシールを先に印刷するのに使う。
   */
  onStarted: (checkout: SquareCheckout, order: OrderEntity) => void;
  /**
   * 支払いが確定したときに呼ぶ。注文を登録できたら true で解決する（ダイアログを閉じる）。
   * false か reject なら phase を paid に戻して、手で送り直せるようにする。
   */
  onPaid: (checkout: SquareCheckout, order: OrderEntity) => Promise<boolean>;
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
 * 決済が先・注文が後。start で端末に決済画面を出し（出せたら onStarted）、完了するまで
 * 問い合わせ続け、支払いが確定したら onPaid に注文を渡す。
 */
export const useSquarePayment = ({ onStarted, onPaid }: Options) => {
  const [state, setState] = useState<SquarePaymentState | null>(null);
  const onStartedRef = useRef(onStarted);
  onStartedRef.current = onStarted;
  const onPaidRef = useRef(onPaid);
  onPaidRef.current = onPaid;

  // 状態が決まった決済依頼を画面の状態に反映する
  const applyCheckout = useCallback((checkout: SquareCheckout) => {
    setState((prev) => {
      if (prev === null || prev.checkout?.id !== checkout.id) {
        return prev;
      }
      // 支払い済みは覆らない。遅れて届いた応答で、送信中の画面を戻さない
      if (prev.phase === "paid" || prev.phase === "submitting") {
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

  // 支払い済みの注文を送る。登録できたら閉じ、できなければ paid に戻して送り直せるようにする。
  const sendPaidOrder = useCallback(
    async (checkout: SquareCheckout, order: OrderEntity) => {
      setState((prev) =>
        prev?.checkout?.id === checkout.id
          ? { ...prev, phase: "submitting", message: null }
          : prev,
      );
      let message: string | null = null;
      try {
        if (await onPaidRef.current(checkout, order)) {
          setState((prev) =>
            prev?.checkout?.id === checkout.id ? null : prev,
          );
          return;
        }
      } catch (error) {
        message = `注文を登録できませんでした: ${error instanceof Error ? error.message : String(error)}`;
      }
      setState((prev) =>
        prev?.checkout?.id === checkout.id
          ? { ...prev, phase: "paid", message }
          : prev,
      );
    },
    [],
  );

  // 支払いが確定したら注文を送る。setState の外で呼ぶ（送信は副作用なので）。
  // 自動で送るのは 1 回だけ。失敗したら「注文を送信」で送り直す。
  const settledRef = useRef<string | null>(null);
  useEffect(() => {
    if (state?.phase !== "paid" || state.checkout === null) {
      return;
    }
    if (settledRef.current === state.checkout.id) {
      return;
    }
    settledRef.current = state.checkout.id;
    void sendPaidOrder(state.checkout, state.order);
  }, [state, sendPaidOrder]);

  const create = useCallback(
    async (base: SquarePaymentState) => {
      setState({ ...base, phase: "creating", message: null });
      try {
        const checkout = await squareRepository.createCheckout({
          idempotencyKey: base.idempotencyKey,
          deviceId: base.deviceId,
          amount: base.order.billingAmount,
          paymentType: base.paymentType,
          orderNumber: base.order.orderId,
        });
        // 送り直しで、もう終わった決済が返ってくることがある。取り消し済みなら始めない（印刷しない）
        const started = checkout.outcome !== "failed";
        setState((prev) =>
          prev?.idempotencyKey === base.idempotencyKey
            ? { ...prev, checkout, phase: "waiting", started }
            : prev,
        );
        if (started) {
          onStartedRef.current(checkout, base.order);
        }
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
    (order: OrderEntity, paymentType: SquarePaymentType, deviceId: string) => {
      if (state !== null) {
        return;
      }
      void create({
        phase: "creating",
        paymentType,
        deviceId,
        idempotencyKey: crypto.randomUUID(),
        order: order.clone(),
        checkout: null,
        started: false,
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
      // 応答を待つ間にポーリングで支払い済みなどに変わっていたら、そのままにする
      // （canceling のときだけ waiting に戻す）
      if (error instanceof SquareCheckoutConflictError) {
        // 既に支払われていた・電子マネーで端末にエラーが出ているなど
        setState((prev) =>
          prev?.phase !== "canceling"
            ? prev
            : { ...prev, phase: "waiting", message: error.message },
        );
        applyCheckout(error.checkout);
        return;
      }
      setState((prev) =>
        prev?.phase !== "canceling"
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
    void sendPaidOrder(state.checkout, state.order);
  }, [state, sendPaidOrder]);

  /**
   * ダイアログを閉じる。お金を受け取っていない・人が確かめる・結果がいつまでも
   * 決まらない・注文の登録に失敗した、のどれかのときだけ（どれに当たるかはダイアログが判断する）。
   * 支払い済みで、まだ送ろうとしていない・送っている途中のときは閉じない。
   */
  const close = useCallback(() => {
    setState((prev) =>
      prev === null ||
      prev.phase === "submitting" ||
      (prev.phase === "paid" && prev.message === null)
        ? prev
        : null,
    );
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
