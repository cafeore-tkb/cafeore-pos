import { collectionSub, orderConverter } from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import { orderBy } from "firebase/firestore";
import { useCallback, useMemo, useRef, useState } from "react";
import { FaCoffee, FaSpinner } from "react-icons/fa";
import { HiBell } from "react-icons/hi2";
import useSWRSubscription from "swr/subscription";
import brightNotifications from "~/assets/bright-notifications.mp3";
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
  const soundRef = useRef<HTMLAudioElement>(null);

  const playSound = useCallback(() => {
    soundRef.current?.play();
  }, []);

  const callingOrders = useMemo(() => {
    if (!orders) return [];

    return orders
      .filter(
        (order) =>
          order.servedAt === null &&
          order.readyAt !== null &&
          displayedOrders.has(order.orderId) &&
          order.orderId !== current &&
          !queue.includes(order.orderId),
      )
      .sort((a, b) => {
        const aReadyAt = a.readyAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const bReadyAt = b.readyAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
        if (aReadyAt !== bReadyAt) {
          return aReadyAt - bReadyAt;
        }
        return a.orderId - b.orderId;
      });
  }, [orders, displayedOrders, current, queue]);

  // スライドアウト完了時のコールバック
  const handleSlideOutComplete = useCallback(
    (orderId: number) => {
      setDisplayedOrders((prev) => new Set([...prev, orderId]));
      setNewlyAddedOrderId(orderId);
      setCurrent(null);
      playSound(); // 左上に表示されるときに音声を再生
    },
    [setDisplayedOrders, setCurrent, playSound],
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
<<<<<<< HEAD
    <div className="flex h-screen flex-col p-2 font-sans">
      <div className="flex h-[70%]">
        {/* 左側：一個ずつ表示 */}
        <div className="flex w-[40%] items-center justify-center border-r">
          {current !== null && (
            <CurrentOrderCard orderId={current} cardRef={currentElementRef} />
          )}
        </div>
=======
<<<<<<< HEAD
    <div className="relative flex h-screen overflow-hidden p-2 font-sans">
      {/* 背景ロゴ */}
      <img
        src={CafeoreLogo}
        alt="Cafeore Logo"
        className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[80%] w-auto -translate-x-1/2 -translate-y-1/2 object-contain opacity-10"
      />
>>>>>>> 762573d (呼び出し画面のレイアウトを変更: 上部70%を左右分割（左40%:個別表示、右60%:一覧）、下部30%を準備中)

        {/* 右側：お呼び出し中 */}
        <div className="w-[60%] p-4">
          <h1 className="mb-2 flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-orange-500 via-theme2025 to-teal-500 py-2 text-center font-bold text-3xl text-white shadow-lg">
            <HiBell className="text-3xl" />
            お呼び出し中
            <HiBell className="text-3xl" />
          </h1>
          <div className="grid grid-cols-3 gap-4">
            {callingOrders.map((order) => (
              <CallingOrderCard
                key={order.id}
                orderId={order.orderId}
                isNewlyAdded={newlyAddedOrderId === order.orderId}
                isAnimated={animatedRightCardsRef.current.has(order.orderId)}
                onCardRef={(el) => {
                  if (el) rightCardRefs.current.set(order.orderId, el);
                }}
                onTextRef={(el) => {
                  if (el) rightTextRefs.current.set(order.orderId, el);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 画面下部（30%）：準備中 */}
      <div className="border-t p-4">
        <h1
          className="mb-2 flex items-center justify-center gap-2 rounded-full py-2 text-center font-bold text-3xl shadow-lg"
          style={{
            backgroundImage:
              "linear-gradient(135deg, #00524f, #00403e, #002e2d)",
            color: "white",
          }}
        >
          <FaCoffee className="text-3xl" />
          ドリップ中
          <FaSpinner
            className="text-3xl"
            style={{ animation: "spin 1.5s linear infinite" }}
          />
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
<<<<<<< HEAD
      <audio src={brightNotifications} ref={soundRef}>
        <track kind="captions" />
      </audio>
=======

      <div className="relative z-10 w-2/3 p-4">
        <div className="h-2/5 border-b">
          {/* お呼び出し中 */}
=======
    <div className="flex h-screen flex-col p-2 font-sans">
      {/* 画面上部（70%） */}
      <div className="flex h-[70%]">
        {/* 左側：一個ずつ表示 */}
        <div className="flex w-[40%] items-center justify-center border-r">
          {current !== null && (
            <div className="animate-pulse rounded-xl border-2 px-16 py-8 font-extrabold text-9xl text-theme2025 shadow-lg">
              {current}
            </div>
          )}
        </div>
        {/* 右側：お呼び出し中 */}
        <div className="w-[60%] p-4">
>>>>>>> 5fb7555 (呼び出し画面のレイアウトを変更: 上部70%を左右分割（左40%:個別表示、右60%:一覧）、下部30%を準備中)
          <h1 className="mb-2 bg-theme2025 text-center font-bold text-3xl text-white">
            お呼び出し中
          </h1>
          <div className="grid grid-cols-5 gap-4">
            {orders?.map(
              (order) =>
                order.servedAt === null &&
                order.readyAt !== null && (
                  <Card
                    key={order.id}
                    className="flex items-center justify-center"
                  >
                    <div className="p-3 font-bold text-7xl">
                      {order.orderId}
                    </div>
                  </Card>
                ),
            )}
          </div>
        </div>
      </div>

      {/* 画面下部（30%） */}
      <div className="border-t p-4">
        <h1 className="mb-2 bg-theme2025 text-center font-bold text-3xl text-white">
          準備中
        </h1>
        <div className="grid grid-cols-8 gap-2">
          {orders?.map(
            (order) =>
              order.servedAt === null &&
              order.readyAt === null && (
                <Card
                  key={order.id}
                  className="flex items-center justify-center border-4"
                >
                  <div className="p-3 font-bold text-5xl">{order.orderId}</div>
                </Card>
              ),
          )}
        </div>
      </div>
>>>>>>> 762573d (呼び出し画面のレイアウトを変更: 上部70%を左右分割（左40%:個別表示、右60%:一覧）、下部30%を準備中)
    </div>
  );
}
