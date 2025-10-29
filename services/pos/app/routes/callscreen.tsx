import { collectionSub, orderConverter } from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import { orderBy } from "firebase/firestore";
import { useCallback, useRef, useState } from "react";
import useSWRSubscription from "swr/subscription";
import {
  CallingOrderCard,
  CurrentOrderCard,
  PreparingOrderCard,
} from "./callscreen.components";
import {
  useCallScreenAnimation,
  useOrderState,
  useQueueProcessing,
  useSlideInAnimation,
} from "./callscreen.hooks";

export const meta: MetaFunction = () => {
  return [{ title: "呼び出し画面 / 珈琲・俺POS" }];
};

export default function FielsOfCallScreen() {
  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }, orderBy("orderId", "asc")),
  );

  const orderState = useOrderState(orders);
  const {
    queue,
    current,
    displayedOrders,
    animatedRightCardsRef,
    setQueue,
    setCurrent,
    setDisplayedOrders,
  } = orderState;

  const currentElementRef = useRef<HTMLDivElement>(null);
  const rightCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const rightTextRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [newlyAddedOrderId, setNewlyAddedOrderId] = useState<number | null>(
    null,
  );

  // スライドアウト完了時のコールバック
  const handleSlideOutComplete = useCallback(
    (orderId: number) => {
      setDisplayedOrders((prev) => new Set([...prev, orderId]));
      setNewlyAddedOrderId(orderId);
      setCurrent(null);
    },
    [setDisplayedOrders, setCurrent],
  );

  // スライドイン完了時のコールバック
  const handleSlideInComplete = useCallback(() => {
    setNewlyAddedOrderId(null);
  }, []);

  useQueueProcessing(current, queue, setCurrent, setQueue);
  useCallScreenAnimation(current, currentElementRef, handleSlideOutComplete);
  useSlideInAnimation(
    newlyAddedOrderId,
    rightCardRefs,
    rightTextRefs,
    animatedRightCardsRef,
    handleSlideInComplete,
  );

  return (
    <div className="flex h-screen flex-col p-2 font-sans">
      <div className="flex h-[70%]">
        {/* 左側：一個ずつ表示 */}
        <div className="flex w-[40%] items-center justify-center border-r">
          {current !== null && (
            <CurrentOrderCard orderId={current} cardRef={currentElementRef} />
          )}
        </div>

        {/* 右側：お呼び出し中 */}
        <div className="w-[60%] p-4">
          <h1 className="mb-2 bg-theme2025 text-center font-bold text-3xl text-white">
            お呼び出し中
          </h1>
          <div className="grid grid-cols-3 gap-4">
            {orders?.map(
              (order) =>
                order.servedAt === null &&
                order.readyAt !== null &&
                displayedOrders.has(order.orderId) &&
                order.orderId !== current &&
                !queue.includes(order.orderId) && (
                  <CallingOrderCard
                    key={order.id}
                    orderId={order.orderId}
                    onCardRef={(el) => {
                      if (el) rightCardRefs.current.set(order.orderId, el);
                    }}
                    onTextRef={(el) => {
                      if (el) rightTextRefs.current.set(order.orderId, el);
                    }}
                  />
                ),
            )}
          </div>
        </div>
      </div>

      {/* 画面下部（30%）：準備中 */}
      <div className="border-t p-4">
        <h1 className="mb-2 bg-theme2025 text-center font-bold text-3xl text-white">
          準備中
        </h1>
        <div className="grid grid-cols-8 gap-2">
          {orders?.map(
            (order) =>
              order.servedAt === null &&
              order.readyAt === null && (
                <PreparingOrderCard key={order.id} orderId={order.orderId} />
              ),
          )}
        </div>
      </div>
    </div>
  );
}
