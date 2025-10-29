import { collectionSub, orderConverter } from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import { orderBy } from "firebase/firestore";
<<<<<<< HEAD
<<<<<<< HEAD
import { useCallback, useMemo, useRef, useState } from "react";
import { FaCoffee, FaSpinner } from "react-icons/fa";
import { HiBell } from "react-icons/hi2";
=======
import { gsap } from "gsap";
import { useEffect, useRef, useState } from "react";
>>>>>>> 0fcb2d4 (feat(callscreen): GSAPアニメーションで新規オーダーのお呼び出し演出を追加)
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
=======
import { useCallback, useRef, useState } from "react";
import useSWRSubscription from "swr/subscription";
<<<<<<< HEAD
<<<<<<< HEAD
import CafeoreLogo from "~/assets/callscreen/cafeore_logo_theme2025.svg";
import { Card } from "~/components/ui/card";
>>>>>>> 4232748 (refactor: callscreen.tsxをコンポーネントとフックに分割)

type GsapCSSVars = Record<string, string | number>;
=======
=======
import brightNotifications from "~/assets/bright-notifications.mp3";
>>>>>>> 3d6b110 (feat: 呼び出し画面で新規注文が左上に表示された時に音声を再生)
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
>>>>>>> 6f03434 (refactor: callscreen.tsxをコンポーネントとフックに分割)

export const meta: MetaFunction = () => {
  return [{ title: "呼び出し画面 / 珈琲・俺POS" }];
};

export default function FielsOfCallScreen() {
  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }, orderBy("orderId", "asc")),
  );

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> 4232748 (refactor: callscreen.tsxをコンポーネントとフックに分割)
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

<<<<<<< HEAD
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
=======
  const [queue, setQueue] = useState<number[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [displayedOrders, setDisplayedOrders] = useState<Set<number>>(
    new Set(),
  );
  const prevOrdersRef = useRef<typeof orders>();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
=======
>>>>>>> 4232748 (refactor: callscreen.tsxをコンポーネントとフックに分割)
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

<<<<<<< HEAD
    // 前回 null → 今回 not null になった order を検出（新しい ready オーダー）
    const newlyReady = orders.filter((order) => {
      const prev = prevOrdersRef.current?.find((p) => p.id === order.id);
      return (
        prev?.readyAt === null &&
        order.readyAt !== null &&
        order.servedAt === null
      );
    });

    if (newlyReady.length > 0) {
      // 新しい ready オーダーは queue に追加（左側で処理される）
      setQueue((prev) => [...prev, ...newlyReady.map((o) => o.orderId)]);
    }

    prevOrdersRef.current = orders;
  }, [orders]);
>>>>>>> 0fcb2d4 (feat(callscreen): GSAPアニメーションで新規オーダーのお呼び出し演出を追加)

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

<<<<<<< HEAD
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

=======
>>>>>>> 4232748 (refactor: callscreen.tsxをコンポーネントとフックに分割)
  useQueueProcessing(current, queue, setCurrent, setQueue);
  useCallScreenAnimation(current, currentElementRef, handleSlideOutComplete);
  useSlideInAnimation(
    newlyAddedOrderId,
    rightCardRefs,
    rightTextRefs,
    animatedRightCardsRef,
    handleSlideInComplete,
  );
<<<<<<< HEAD
=======
    // 次の要素を0.5秒待つ
    const timerId = setTimeout(() => {
      const next = queue[0];
      setQueue((prev) => prev.slice(1));
      setCurrent(next);
    }, 500);
    return () => clearTimeout(timerId);
  }, [current, queue]);

  // current が設定されたら、GSAPアニメーションを実行
  useEffect(() => {
    if (current === null || !currentElementRef.current) return;

    const element = currentElementRef.current;
    const currentOrderId = current;

    // 初期位置をリセット
    gsap.set(element, { x: 0, opacity: 1, scale: 1 });

    // スライドアウトアニメーション（すぐに実行）
    const slideOutTimeline = gsap.timeline({ delay: 1 });
    const slideDistance = window.innerWidth * 0.5; // 左側40%から右側10%くらいまで
    slideOutTimeline.to(element, {
      x: slideDistance,
      opacity: 0,
      duration: 0.8,
      ease: "power2.in",
      onComplete: () => {
        // スライドアウト完了後、右側に追加
        setDisplayedOrders((prev) => new Set([...prev, currentOrderId]));
        setNewlyAddedOrderId(currentOrderId);
        setCurrent(null);
      },
    });

    return () => {
      slideOutTimeline.kill();
      if (element) {
        gsap.set(element, { clearProps: "all" });
      }
    };
  }, [current]);
>>>>>>> 0fcb2d4 (feat(callscreen): GSAPアニメーションで新規オーダーのお呼び出し演出を追加)

  // 新しく追加されたオーダーにスライドインアニメーションを適用
  useEffect(() => {
    if (newlyAddedOrderId === null) return;

    // DOMに追加された後にアニメーションを実行
    const timer = setTimeout(() => {
<<<<<<< HEAD
      const cardElement = rightCardRefs.current.get(newlyAddedOrderId);
      if (cardElement) {
        gsap.fromTo(
          cardElement,
          { x: -100, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.5,
            ease: "power2.out",
            onComplete: () => {
              setNewlyAddedOrderId(null);
            },
          },
        );
      }
=======
      requestAnimationFrame(() => {
        const cardElement = rightCardRefs.current.get(newlyAddedOrderId);
        const textElement = rightTextRefs.current.get(newlyAddedOrderId);
        if (cardElement && textElement) {
          if (animatedRightCardsRef.current.has(newlyAddedOrderId)) {
            setNewlyAddedOrderId(null);
            return;
          }

          // カードのスライドインアニメーション（位置・透明度）
          // 文字要素のグラデーションは初期オレンジにセット
          gsap.set(cardElement, {
            x: -100,
            opacity: 0,
          });
          gsap.set(textElement, {
            "--grad-start": "#f97316", // orange-500
            "--grad-mid": "#ea580c", // orange-600
            "--grad-end": "#ef4444", // red-500
          } as GsapCSSVars);

          const timeline = gsap.timeline({
            defaults: { ease: "power2.out" },
            onComplete: () => {
              animatedRightCardsRef.current.add(newlyAddedOrderId);
              setNewlyAddedOrderId(null);
            },
          });

          // スライドインと同時に色のアニメーション開始
          timeline.to(cardElement, { x: 0, opacity: 1, duration: 0.5 }, 0).to(
            textElement,
            {
              "--grad-start": "#14b8a6", // theme2025想定: teal-500 近似
              "--grad-mid": "#0d9488", // teal-600
              "--grad-end": "#14b8a6",
              duration: 1.0,
            } as GsapCSSVars,
            0.5, // スライドイン開始後少し経ってから開始
          );
        }
      });
>>>>>>> 9b2115c (refactor: お呼び出し画面のアニメーションをGSAP+CSS変数方式に変更)
    }, 0);

    return () => {
      clearTimeout(timer);
      setNewlyAddedOrderId(null);
    };
  }, [newlyAddedOrderId]);
=======
>>>>>>> 4232748 (refactor: callscreen.tsxをコンポーネントとフックに分割)

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
      <div className="flex h-[70%]">
        {/* 左側：一個ずつ表示 */}
        <div className="flex w-[40%] items-center justify-center border-r">
          {current !== null && (
<<<<<<< HEAD
            <div
              ref={currentElementRef}
              className="rounded-xl border-2 px-16 py-8 font-extrabold text-9xl text-theme2025 shadow-lg"
            >
              {current}
            </div>
=======
            <CurrentOrderCard orderId={current} cardRef={currentElementRef} />
>>>>>>> 4232748 (refactor: callscreen.tsxをコンポーネントとフックに分割)
          )}
        </div>

        {/* 右側：お呼び出し中 */}
        <div className="w-[60%] p-4">
<<<<<<< HEAD
>>>>>>> 5fb7555 (呼び出し画面のレイアウトを変更: 上部70%を左右分割（左40%:個別表示、右60%:一覧）、下部30%を準備中)
          <h1 className="mb-2 bg-theme2025 text-center font-bold text-3xl text-white">
=======
          <h1 className="mb-2 rounded-full bg-gradient-to-r from-orange-500 via-theme2025 to-teal-500 py-2 text-center font-bold text-3xl text-white shadow-lg">
>>>>>>> ecd8638 (feat: 呼び出し画面のヘッダーデザインを改善)
            お呼び出し中
          </h1>
          <div className="grid grid-cols-5 gap-4">
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
<<<<<<< HEAD
                    className="flex items-center justify-center"
                  >
<<<<<<< HEAD
                    <div className="p-3 font-bold text-7xl">
=======
                    <div
                      ref={(el) => {
                        if (el) {
                          rightTextRefs.current.set(order.orderId, el);
                        }
                      }}
                      className="pointer-events-none bg-clip-text font-bold text-7xl text-transparent"
                      style={{
                        WebkitBackgroundClip: "text",
                        backgroundClip: "text",
                        backgroundImage:
                          "linear-gradient(135deg, var(--grad-start, #14b8a6), var(--grad-mid, #0d9488), var(--grad-end, #14b8a6))",
                      }}
                    >
>>>>>>> 9b2115c (refactor: お呼び出し画面のアニメーションをGSAP+CSS変数方式に変更)
                      {order.orderId}
                    </div>
                  </Card>
=======
                    onTextRef={(el) => {
                      if (el) rightTextRefs.current.set(order.orderId, el);
                    }}
                  />
>>>>>>> 4232748 (refactor: callscreen.tsxをコンポーネントとフックに分割)
                ),
            )}
          </div>
        </div>
      </div>

      {/* 画面下部（30%）：準備中 */}
      <div className="border-t p-4">
        <h1
          className="mb-2 rounded-full py-2 text-center font-bold text-3xl shadow-lg"
          style={{
            backgroundImage:
              "linear-gradient(135deg, #00524f, #00403e, #002e2d)",
            color: "white",
          }}
        >
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
<<<<<<< HEAD
>>>>>>> 762573d (呼び出し画面のレイアウトを変更: 上部70%を左右分割（左40%:個別表示、右60%:一覧）、下部30%を準備中)
=======
      <audio src={brightNotifications} ref={soundRef}>
        <track kind="captions" />
      </audio>
>>>>>>> 6d771ab (feat: 呼び出し画面で新規注文が左上に表示された時に音声を再生)
    </div>
  );
}
