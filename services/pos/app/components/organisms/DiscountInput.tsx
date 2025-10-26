import { OrderEntity, type WithId } from "@cafeore/common";
import { CheckCircledIcon, CrossCircledIcon } from "@radix-ui/react-icons";
import {
  type ComponentPropsWithoutRef,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "~/lib/utils";
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
    const otpRef = useRef<HTMLInputElement>(null);
    const previousFocusRef = useRef<boolean>(focus);

    // InputOTPに対してフォーカス制御を行う
    useEffect(() => {
      // focusが変更された場合のみ処理
      if (previousFocusRef.current === focus) return;
      previousFocusRef.current = focus;

      const rafId = requestAnimationFrame(() => {
        if (otpRef.current) {
          if (focus) {
            otpRef.current.focus();
            if (discountOrderId.length === 3) {
              // 3桁入力済みの場合、カーソルを最後に移動
              const length = otpRef.current.value.length;
              otpRef.current.setSelectionRange(length, length);
            }
          } else {
            // フォーカスが外れたらblurする
            otpRef.current.blur();
          }
        }
      });
      return () => cancelAnimationFrame(rafId);
    }, [focus, discountOrderId]);

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
      () => discountOrder?.getCoffeeCups().length ?? 0,
      [discountOrder],
    );

    /**
     * FIXME #412 useEffect内でstateを更新している
     * https://ja.react.dev/learn/you-might-not-need-an-effect#notifying-parent-components-about-state-changes
     */
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
              ref={otpRef}
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
