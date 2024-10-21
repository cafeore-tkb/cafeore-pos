import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import type { WithId } from "common/lib/typeguard";
import { cn } from "common/lib/utils";
import { OrderEntity } from "common/models/order";
import {
  type ComponentPropsWithoutRef,
  memo,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useFocusRef } from "../functional/useFocusRef";
import { ThreeDigitsInput } from "../molecules/ThreeDigitsInput";

const findByOrderId = (
  orders: WithId<OrderEntity>[] | undefined,
  orderId: number,
): WithId<OrderEntity> | undefined => {
  return orders?.find((order) => order.orderId === orderId);
};

type props = ComponentPropsWithoutRef<typeof ThreeDigitsInput> & {
  focus: boolean;
  orders: WithId<OrderEntity>[] | undefined;
  onDiscountOrderFind: (order: WithId<OrderEntity>) => void;
  onDiscountOrderRemoved: () => void;
};

/**
 * 割引券番号を入力するためのコンポーネント
 */
const DiscountInput = memo(
  ({
    focus,
    orders,
    onDiscountOrderFind,
    onDiscountOrderRemoved,
    ...props
  }: props) => {
    const [discountOrderId, setDiscountOrderId] = useState("");
    const ref = useFocusRef<HTMLInputElement>(focus);

    const isComplete = useMemo(
      () => discountOrderId.length === 3,
      [discountOrderId],
    );

    const discountOrder = useMemo(() => {
      if (!isComplete) return;
      const discountOrderIdNum = Number(discountOrderId);
      return findByOrderId(orders, discountOrderIdNum);
    }, [orders, isComplete, discountOrderId]);

    const lastPurchasedCups = useMemo(
      () => discountOrder?.getCoffeeCount() ?? 0,
      [discountOrder],
    );

    useEffect(() => {
      if (isComplete && discountOrder) {
        onDiscountOrderFind(discountOrder);
      }
      return onDiscountOrderRemoved;
    }, [
      isComplete,
      discountOrder,
      onDiscountOrderFind,
      onDiscountOrderRemoved,
    ]);

    return (
      <div className="">
        <div className="flex justify-center p-6">
          <div className="">
            <p className="pb-1 text-sm">番号</p>
            <ThreeDigitsInput
              ref={ref}
              value={discountOrderId}
              onChange={(value) => setDiscountOrderId(value)}
              disabled={!focus}
              {...props}
            />
          </div>
        </div>
        <div className="flex flex-col items-center gap-5">
          {!isComplete && (
            <div className="flex items-center">
              {/* <ExclamationTriangleIcon className="mr-1 stroke-stone-400" /> */}
              <p className="text-sm text-stone-400">
                3桁すべて入力してください
              </p>
            </div>
          )}
          {isComplete &&
            (discountOrder instanceof OrderEntity ? (
              <>
                <div className="flex items-center">
                  <CheckCircledIcon className="mr-1 h-5 w-5 stroke-green-700" />
                  <p className="flex items-center">
                    <span className="mr-1 text-lg">{lastPurchasedCups}</span>
                    杯分
                  </p>
                </div>
                <ul className="list-disc pl-4">
                  {discountOrder.items.map((item, idx) => (
                    <li
                      key={`${idx}-${item.id}`}
                      className={cn(
                        "text-sm text-stone-600",
                        (item.type === "milk" || item.type === "others") &&
                          "text-stone-400",
                      )}
                    >
                      {item.name}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="flex items-center">
                <CrossCircledIcon className="mr-1 h-5 w-5 stroke-red-700" />
                <p className="flex items-center">無効な番号</p>
              </div>
            ))}
        </div>
      </div>
    );
  },
);

export { DiscountInput };
