import { collectionSub, orderConverter } from "@cafeore/common";
import type { MetaFunction } from "@remix-run/react";
import { orderBy } from "firebase/firestore";
import { useEffect, useRef, useState } from "react";
import useSWRSubscription from "swr/subscription";
import CafeoreLogo from "~/assets/callscreen/cafeore_logo_theme2025.svg";
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
  const prevOrdersRef = useRef<typeof orders>();
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!orders || !prevOrdersRef.current) {
      prevOrdersRef.current = orders;
      return;
    }

    // 前回 null → 今回 not null になった order を検出
    const newlyReady = orders.filter((order) => {
      const prev = prevOrdersRef.current?.find((p) => p.id === order.id);
      return (
        prev?.readyAt === null &&
        order.readyAt !== null &&
        order.servedAt === null
      );
    });

    if (newlyReady.length > 0) {
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

  // current が設定されたら 5秒後に null に戻す
  useEffect(() => {
    if (current === null) return;

    timerRef.current = setTimeout(() => {
      setCurrent(null);
      timerRef.current = null;
    }, 5000);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [current]);

  return (
    <div className="relative flex h-screen overflow-hidden p-2 font-sans">
      {/* 背景ロゴ */}
      <img
        src={CafeoreLogo}
        alt="Cafeore Logo"
        className="pointer-events-none absolute left-1/2 top-1/2 z-0 h-[80%] w-auto -translate-x-1/2 -translate-y-1/2 object-contain opacity-10"
      />

      {/* 準備中 */}
      <div className="relative z-10 w-1/3 border-r p-4">
        <h1 className="mb-2 bg-theme2025 text-center font-bold text-3xl text-white">
          準備中
        </h1>
        <div className="grid grid-cols-4 gap-2">
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

      <div className="relative z-10 w-2/3 p-4">
        <div className="h-2/5 border-b">
          {/* お呼び出し中 */}
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
        {/* 一個ずつ表示 */}
        <div className="flex h-3/5 items-center justify-center">
          {current !== null && (
            <div className="animate-pulse rounded-xl border-2 px-16 py-8 font-extrabold text-9xl text-theme2025 shadow-lg">
              {current}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
