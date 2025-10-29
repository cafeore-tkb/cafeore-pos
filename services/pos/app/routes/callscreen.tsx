import { collectionSub, orderConverter } from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import { orderBy } from "firebase/firestore";
import { gsap } from "gsap";
import { useEffect, useRef, useState } from "react";
import useSWRSubscription from "swr/subscription";
import { Card } from "~/components/ui/card";

type GsapCSSVars = Record<string, string | number>;

export const meta: MetaFunction = () => {
  return [{ title: "呼び出し画面 / 珈琲・俺POS" }];
};

export default function FielsOfCallScreen() {
  const { data: orders } = useSWRSubscription(
    "orders",
    collectionSub({ converter: orderConverter }, orderBy("orderId", "asc")),
  );

  const [queue, setQueue] = useState<number[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [displayedOrders, setDisplayedOrders] = useState<Set<number>>(
    new Set(),
  );
  const prevOrdersRef = useRef<typeof orders>();
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const currentElementRef = useRef<HTMLDivElement>(null);
  const leftContainerRef = useRef<HTMLDivElement>(null);
  const rightCardRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const rightTextRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const [newlyAddedOrderId, setNewlyAddedOrderId] = useState<number | null>(
    null,
  );
  const animatedRightCardsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!orders) return;

    // 初期化時は、readyAtが設定されているオーダーを全てdisplayedOrdersに追加
    // それ以降は、ready になった新しいオーダーのみ queue に追加
    if (!prevOrdersRef.current) {
      const existingReadyOrders = orders.filter(
        (order) => order.readyAt !== null && order.servedAt === null,
      );
      setDisplayedOrders(new Set(existingReadyOrders.map((o) => o.orderId)));
      prevOrdersRef.current = orders;
      return;
    }

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

  // current が null になったら次を表示
  useEffect(() => {
    if (current !== null) return;
    if (queue.length === 0) return;

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
    const slideDistance = window.innerWidth * 0.1; // 左側40%から右側10%くらいまで
    slideOutTimeline.to(element, {
      x: slideDistance,
      opacity: 0,
      duration: 0.5,
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

  // 新しく追加されたオーダーにスライドインアニメーションを適用
  useEffect(() => {
    if (newlyAddedOrderId === null) return;

    // DOMに追加された後にアニメーションを実行
    const timer = setTimeout(() => {
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
    }, 0);

    return () => {
      clearTimeout(timer);
      setNewlyAddedOrderId(null);
    };
  }, [newlyAddedOrderId]);

  return (
    <div className="flex h-screen flex-col p-2 font-sans">
      {/* 画面上部（70%） */}
      <div className="flex h-[70%]">
        {/* 左側：一個ずつ表示 */}
        <div
          ref={leftContainerRef}
          className="flex w-[40%] items-center justify-center border-r"
        >
          {current !== null && (
            <div
              ref={currentElementRef}
              className="relative flex items-center justify-center rounded-2xl px-16 py-8"
              style={{
                boxShadow:
                  "8px 8px 16px rgba(0, 0, 0, 0.3), -8px -8px 16px rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
              }}
            >
              <div className="bg-gradient-to-br from-theme2025 via-teal-600 to-theme2025 bg-clip-text font-extrabold text-9xl text-transparent">
                {current}
              </div>
            </div>
          )}
        </div>
        {/* 右側：お呼び出し中 */}
        <div className="w-[60%] p-4">
          <h1 className="mb-2 bg-theme2025 text-center font-bold text-3xl text-white">
            お呼び出し中
          </h1>
          <div className="grid grid-cols-4 gap-4">
            {orders?.map(
              (order) =>
                order.servedAt === null &&
                order.readyAt !== null &&
                displayedOrders.has(order.orderId) &&
                order.orderId !== current &&
                !queue.includes(order.orderId) && (
                  <Card
                    key={order.id}
                    ref={(el) => {
                      if (el) {
                        rightCardRefs.current.set(order.orderId, el);
                      }
                    }}
                    className="relative flex items-center justify-center rounded-2xl px-8 py-3"
                    style={{
                      boxShadow:
                        "8px 8px 16px rgba(0, 0, 0, 0.3), -8px -8px 16px rgba(255, 255, 255, 0.5), inset 0 0 0 1px rgba(255, 255, 255, 0.1)",
                    }}
                  >
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
    </div>
  );
}
