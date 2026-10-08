import { useEffect, useRef, useState } from "react";
import { historicalArrivals, ordersInPeriod } from "../logic/historical";
import type { DripCard, HistoricalOrder, TestPlaySession } from "../types";

// 実データテスト。過去の注文の時刻を 1 秒ずつ進め（速さはヘッダーの 1x〜10x）、時刻が来た注文をカードにして届ける。
// 終わりの時刻に着いたら onTimeUp（タイマーを止める）。historicalOrders は読み込んだ実データの注文（usePracticeData）。
export const useTestPlay = ({
  historicalOrders,
  initial,
  isRunning,
  simSpeed,
  receive,
  onTimeUp,
}: {
  historicalOrders: HistoricalOrder[];
  initial: TestPlaySession | null;
  isRunning: boolean;
  simSpeed: number;
  receive: (incoming: DripCard[]) => void;
  onTimeUp: () => void;
}) => {
  const [session, setSession] = useState<TestPlaySession | null>(initial);
  const cursor = useRef(0);
  const status = session?.status;
  const currentMs = session?.currentMs;
  const endMs = session?.endMs;
  const orders = session?.orders;

  // One test-play tick advances one second of historical time. The shared
  // speed control changes the tick frequency so the clock, timeline, order
  // arrivals, and brewing countdown all stay on the same multiplier.
  useEffect(() => {
    if (status !== "active" || !isRunning) return;
    const timer = window.setInterval(() => {
      setSession((prev) =>
        prev
          ? { ...prev, currentMs: Math.min(prev.endMs, prev.currentMs + 1_000) }
          : prev,
      );
    }, 1000 / simSpeed);
    return () => window.clearInterval(timer);
  }, [status, isRunning, simSpeed]);

  useEffect(() => {
    if (
      status === "active" &&
      currentMs !== undefined &&
      endMs !== undefined &&
      currentMs >= endMs
    )
      onTimeUp();
  }, [currentMs, endMs, status, onTimeUp]);

  useEffect(() => {
    if (status !== "active" || currentMs === undefined || !orders) return;
    const arrivals = historicalArrivals(orders, cursor.current, currentMs);
    cursor.current = arrivals.cursor;
    if (arrivals.cards.length > 0) receive(arrivals.cards);
  }, [currentMs, orders, status, receive]);

  return {
    session,
    /** 時間帯（startMs から durationMinutes 分）でテストを始める */
    start: (startMs: number, durationMinutes: 30 | 60) => {
      const sessionEndMs = startMs + durationMinutes * 60_000;
      cursor.current = 0;
      setSession({
        status: "active",
        startMs,
        endMs: sessionEndMs,
        currentMs: startMs,
        durationMinutes,
        orders: ordersInPeriod(historicalOrders, startMs, sessionEndMs),
      });
    },
    /** テストを終える（実績を見るために、リセットするまで盤面と時刻は残す） */
    finish: () =>
      setSession((prev) => (prev ? { ...prev, status: "finished" } : prev)),
    /** テストをやめる */
    clear: () => {
      cursor.current = 0;
      setSession(null);
    },
  };
};
