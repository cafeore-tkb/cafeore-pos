import {
  type OrderEntity,
  type WithId,
  getDiscountOrderStatus,
} from "@cafeore/common";
import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import {
  type ComponentPropsWithoutRef,
  memo,
  useEffect,
  useMemo,
  useState,
} from "react";
import { cn } from "~/lib/utils";
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

    const discountOrderStatus = useMemo(() => {
      if (!isComplete) return null;
      const discountOrderIdNum = Number(discountOrderId);
      return getDiscountOrderStatus(discountOrderIdNum, orders || []);
    }, [orders, isComplete, discountOrderId]);

    const discountOrder = useMemo(() => {
      if (!isComplete || discountOrderStatus !== "available") return null;
      const discountOrderIdNum = Number(discountOrderId);
      return findByOrderId(orders, discountOrderIdNum);
    }, [orders, isComplete, discountOrderId, discountOrderStatus]);

    const lastPurchasedCups = useMemo(
      () => discountOrder?.getCoffeeCups().length ?? 0,
      [discountOrder],
    );

    /**
     * FIXME #412 useEffect内でstateを更新している
     * https://ja.react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes
     */
    useEffect(() => {
      if (isComplete && discountOrder && discountOrderStatus === "available") {
        onDiscountOrderFind(discountOrder);
      } else {
        onDiscountOrderRemoved();
      }
    }, [
      isComplete,
      discountOrder,
      discountOrderStatus,
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
              {...props}
            />
          </div>
        </div>
        <div className="flex flex-col items-center gap-5">
          {!isComplete && (
            <div className="flex items-center">
              <p className="text-sm text-stone-400">
                3桁すべて入力してください
              </p>
            </div>
          )}
          {isComplete &&
            (discountOrderStatus === "available" && discountOrder ? (
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
            ) : discountOrderStatus === "already_used" ? (
              <div className="flex items-center">
                <CrossCircledIcon className="mr-1 h-5 w-5 stroke-red-700" />
                <p className="text-red-700 text-sm">
                  この番号はもうすでに使用済みの番号です。割引は適用されません。
                </p>
              </div>
            ) : discountOrderStatus === "unserved" ? (
              <div className="flex items-center">
                <CrossCircledIcon className="mr-1 h-5 w-5 stroke-red-700" />
                <p className="text-red-700 text-sm">
                  この番号はまだ提供されていない番号です。割引は適用されません。
                </p>
              </div>
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
