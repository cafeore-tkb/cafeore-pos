import type { OrderEntity } from "@cafeore/common";
import { shouldSplitOrder, useItemMaster } from "@cafeore/common";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "../ui/button";

type props = {
  submitOrder: () => void;
  onExactPayment: () => void;
  order: OrderEntity;
  focus: boolean;
  focusTarget: "submit" | "exactPayment";
};

export const SubmitSection = ({
  submitOrder,
  onExactPayment,
  order,
  focus,
  focusTarget,
}: props) => {
  const submitButtonRef = useRef<HTMLButtonElement>(null);
  const exactPaymentButtonRef = useRef<HTMLButtonElement>(null);
  const billingOk = useMemo(
    () => order.items.length > 0 && order.getCharge() >= 0,
    [order],
  );

  const itemMaster = useItemMaster().items;
  const needsSplit = useMemo(
    () => shouldSplitOrder(order.items, itemMaster),
    [order.items, itemMaster],
  );

  /**
   * OK
   */
  useEffect(() => {
    if (!focus) return;
    if (focusTarget === "submit" && billingOk) {
      submitButtonRef.current?.focus();
    } else if (order.items.length > 0) {
      exactPaymentButtonRef.current?.focus();
    }
  }, [focus, focusTarget, billingOk, order.items.length]);

  return (
    <div className="pt-5">
      <div className="flex flex-col items-center gap-2">
        <Button
          id="submit-button"
          ref={submitButtonRef}
          className="h-20 w-40 bg-stone-900 font-bold text-2xl hover:bg-pink-700 focus-visible:ring-4 focus-visible:ring-pink-500 disabled:bg-stone-400"
          onClick={() => submitOrder()}
          disabled={!billingOk}
        >
          {billingOk && "送信"}
          {!billingOk && "送信不可"}
        </Button>
        <label htmlFor="submit-button" className="text-sm text-stone-400">
          赤枠が出ている状態で Enter で送信
        </label>
        <Button
          id="exact-payment-button"
          ref={exactPaymentButtonRef}
          className="h-14 w-40 bg-stone-700 font-bold text-lg text-white hover:bg-stone-600 focus-visible:ring-4 focus-visible:ring-stone-400 disabled:bg-stone-400"
          onClick={() => onExactPayment()}
          disabled={order.items.length === 0}
        >
          お釣り 0
        </Button>
        <label
          htmlFor="exact-payment-button"
          className="text-sm text-stone-400"
        >
          合計どおり受け取ったとき
        </label>
        <p className="text-sm text-stone-400">
          上下キーで「送信」と「お釣り 0」を選択
        </p>
        {needsSplit && (
          <p className="text-center font-bold text-red-500">
            この注文の分割を推奨します
          </p>
        )}
      </div>
    </div>
  );
};
