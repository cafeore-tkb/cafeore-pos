import { collectionSub, orderConverter } from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import { orderBy } from "firebase/firestore";
import { gsap } from "gsap";
import { useEffect, useRef, useState } from "react";
import useSWRSubscription from "swr/subscription";
import { Card } from "~/components/ui/card";

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
  const [newlyAddedOrderId, setNewlyAddedOrderId] = useState<number | null>(
    null,
  );

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

  // 新しく追加されたオーダーにスライドインアニメーションを適用
  useEffect(() => {
    if (newlyAddedOrderId === null) return;

    // DOMに追加された後にアニメーションを実行
    const timer = setTimeout(() => {
      const cardElement = rightCardRefs.current.get(newlyAddedOrderId);
      if (cardElement) {
        const timeline = gsap.timeline();

        // スライドインアニメーション
        timeline.fromTo(
          cardElement,
          { x: -100, opacity: 0 },
          {
            x: 0,
            opacity: 1,
            duration: 0.5,
            ease: "power2.out",
          },
        );

        // スライドイン完了後、オレンジで点滅アニメーション（数秒間）
        // 現在の文字色を取得（デフォルトはカードの文字色）
        const defaultTextColor = window.getComputedStyle(cardElement).color;

        timeline.to(cardElement, {
          color: "#ea580c", // orange-600
          duration: 0.4,
          repeat: 4, // 合計5回点滅（往復で約2.4秒）
          yoyo: true,
          ease: "power2.inOut",
        });

        // 点滅終了後、滑らかに元の文字色に戻す
        timeline.to(cardElement, {
          color: defaultTextColor,
          duration: 1,
          ease: "power2.out",
          onComplete: () => {
            setNewlyAddedOrderId(null);
          },
        });
      }
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
              className="rounded-xl border-2 px-16 py-8 font-extrabold text-9xl text-theme2025 shadow-lg"
            >
              {current}
            </div>
          )}
        </div>
        {/* 右側：お呼び出し中 */}
        <div className="w-[60%] p-4">
          <h1 className="mb-2 bg-theme2025 text-center font-bold text-3xl text-white">
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
                  <Card
                    key={order.id}
                    ref={(el) => {
                      if (el) {
                        rightCardRefs.current.set(order.orderId, el);
                      }
                    }}
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
    </div>
  );
}
