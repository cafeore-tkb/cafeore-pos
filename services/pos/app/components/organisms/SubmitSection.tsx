import type { OrderEntity } from "@cafeore/common";
import { generateSimpleRecommendation, ITEM_MASTER } from "@cafeore/common";
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

  // 分割が必要かチェック
  const shouldSplit = order.shouldSplitOrder();
  
  // 分割が必要な場合の推奨案を生成
  const recommendations = useMemo(() => {
    if (shouldSplit) {
      return generateSimpleRecommendation(order.items);
    }
    return null;
  }, [shouldSplit, order.items]);

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
        {shouldSplit && recommendations && (
          <div className="mt-2 text-sm font-semibold text-red-600">
            <div className="mb-2">注文番号の分割を推奨します</div>
            <div className="text-xs text-red-500">
              {recommendations.map((order, index) => (
                <div key={index} className="mb-1">
                  注文{index + 1}: {order.map(item => {
                    const itemMaster = Object.values(ITEM_MASTER).find(im => im.id === item.id);
                    const unit = itemMaster?.type === "others" ? "個" : "杯";
                    return `${item.name}${item.count}${unit}`;
                  }).join(' + ')}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
