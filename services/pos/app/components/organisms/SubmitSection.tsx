import type { OrderEntity, SquarePaymentType } from "@cafeore/common";
import { shouldSplitOrder } from "@cafeore/common";
import { useEffect, useMemo, useRef } from "react";
import {
  type SubmitFocusTarget,
  resolveSubmitFocus,
} from "../functional/submitFocus";
import { Button } from "../ui/button";
import { squarePaymentTypeLabel } from "./SquarePaymentDialog";

type props = {
  submitOrder: () => void;
  onExactPayment: () => void;
  order: OrderEntity;
  focus: boolean;
  focusTarget: SubmitFocusTarget;
  /** 押せるボタン（Square のボタンは連携が有効なときだけ含める） */
  availableTargets: readonly SubmitFocusTarget[];
  /** 表示する Square のボタン。連携が無効なら空 */
  squarePaymentTypes: readonly SquarePaymentType[];
  onSquarePayment: (paymentType: SquarePaymentType) => void;
};

export const SubmitSection = ({
  submitOrder,
  onExactPayment,
  order,
  focus,
  focusTarget,
  availableTargets,
  squarePaymentTypes,
  onSquarePayment,
}: props) => {
  const buttonRefs = useRef<
    Partial<Record<SubmitFocusTarget, HTMLButtonElement | null>>
  >({});
  const billingOk = useMemo(
    () => order.menus.length > 0 && order.getCharge() >= 0,
    [order],
  );

  const needsSplit = useMemo(
    () => shouldSplitOrder(order.menus),
    [order.menus],
  );

  /**
   * OK
   */
  useEffect(() => {
    if (!focus) return;
    const target = resolveSubmitFocus(focusTarget, availableTargets);
    if (target !== null) {
      buttonRefs.current[target]?.focus();
    }
  }, [focus, focusTarget, availableTargets]);

  const disabled = (target: SubmitFocusTarget) =>
    !availableTargets.includes(target);

  return (
    <div className="pt-5">
      <div className="flex flex-col items-center gap-2">
        <Button
          id="submit-button"
          ref={(element) => {
            buttonRefs.current.submit = element;
          }}
          className="h-20 w-40 bg-stone-900 font-bold text-2xl hover:bg-pink-700 focus-visible:ring-4 focus-visible:ring-pink-500 disabled:bg-stone-400"
          onClick={() => submitOrder()}
          disabled={disabled("submit")}
        >
          {billingOk && "送信"}
          {!billingOk && "送信不可"}
        </Button>
        <label htmlFor="submit-button" className="text-sm text-stone-400">
          赤枠が出ている状態で Enter で送信
        </label>
        <Button
          id="exact-payment-button"
          ref={(element) => {
            buttonRefs.current.exactPayment = element;
          }}
          className="h-14 w-40 bg-stone-700 font-bold text-lg text-white hover:bg-stone-600 focus-visible:ring-4 focus-visible:ring-stone-400 disabled:bg-stone-400 disabled:text-stone-300"
          onClick={() => onExactPayment()}
          disabled={disabled("exactPayment")}
        >
          お釣り 0
        </Button>
        <label
          htmlFor="exact-payment-button"
          className="text-sm text-stone-400"
        >
          合計どおり受け取ったとき
        </label>
        {squarePaymentTypes.length > 0 && (
          <div className="mt-3 flex flex-col items-center gap-2 border-stone-200 border-t-2 pt-3">
            <p className="text-sm text-stone-500">Square 端末で決済</p>
            {squarePaymentTypes.map((paymentType) => (
              <Button
                key={paymentType}
                ref={(element) => {
                  buttonRefs.current[paymentType] = element;
                }}
                className="h-12 w-40 bg-sky-800 font-bold text-lg text-white hover:bg-sky-700 focus-visible:ring-4 focus-visible:ring-sky-400 disabled:bg-stone-400 disabled:text-stone-300"
                onClick={() => onSquarePayment(paymentType)}
                disabled={disabled(paymentType)}
              >
                {squarePaymentTypeLabel[paymentType]}
              </Button>
            ))}
            <p className="text-sm text-stone-400">↑↓ で選んで Enter</p>
          </div>
        )}
        {needsSplit && (
          <p className="text-center font-bold text-red-500">
            この注文の分割を推奨します
          </p>
        )}
      </div>
    </div>
  );
};
