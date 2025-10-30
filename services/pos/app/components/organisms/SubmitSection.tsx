import type { OrderEntity } from "@cafeore/common";
import { shouldSplitOrder } from "@cafeore/common";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "../ui/button";

type props = {
  submitOrder: () => void;
  order: OrderEntity;
  focus: boolean;
};

export const SubmitSection = ({ submitOrder, order, focus }: props) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const billingOk = useMemo(
    () => order.items.length > 0 && order.getCharge() >= 0,
    [order],
  );

  const needsSplit = useMemo(
    () => shouldSplitOrder(order.items),
    [order.items],
  );

  /**
   * OK
   */
  useEffect(() => {
    if (focus) {
      buttonRef.current?.focus();
    }
  }, [focus]);

  return (
    <div className="pt-5">
      <div className="flex flex-col items-center gap-2">
        <Button
          id="submit-button"
          ref={buttonRef}
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
        {needsSplit && (
          <p className="text-red-500 font-bold text-center">
            この注文の分割を推奨します
          </p>
        )}
      </div>
    </div>
  );
};
