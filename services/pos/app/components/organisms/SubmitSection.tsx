import type { OrderEntity } from "@cafeore/common";
import { useEffect, useMemo, useRef } from "react";
import { Button } from "../ui/button";

type props = {
  submitOrder: () => void;
  order: OrderEntity;
  focus: boolean;
  splitDetails?: ReturnType<OrderEntity["shouldSplitOrder"]>;
};

export const SubmitSection = ({ submitOrder, order, focus, splitDetails }: props) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const billingOk = useMemo(
    () => order.items.length > 0 && order.getCharge() >= 0,
    [order],
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
        {splitDetails?.shouldSplit && splitDetails.recommendation && (
          <div className="mt-2 text-sm font-semibold text-red-600">
            <div className="mb-2">注文番号の分割を推奨します</div>
            <div className="text-xs text-red-500">
              {splitDetails.recommendation.map((order, index) => (
                <div key={index} className="mb-1">
                  注文{index + 1}: {order.map(item => `${item.name}${item.count}${item.name.includes('杯') ? '' : '個'}`).join(' + ')}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
