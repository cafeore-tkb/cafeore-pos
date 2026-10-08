import {
  type CaosPracticeOrder,
  type CaosPracticeResult,
  type CaosWritesResult,
  advanceCaosPracticeDripper,
  applyCaosPracticeWrites,
  buildCaosCards,
  cupNeedsBrew,
  jstDate,
  jstDayStart,
  toCaosPracticeOrder,
} from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
import { caosBoardActions } from "../live/actions";
import { cardsToBoard } from "../live/board";
import { ERROR_SHOWN_MS } from "../live/useLiveCaosBoard";
import type { Barista, HistoricalOrder, TestPlaySession } from "../types";

// 実データテスト（練習）の盤面。実データの注文を、練習の時計（1〜10 倍速）に合わせて届いた順に盤面に出す。
// 盤面はブラウザの中だけで持ち（本番と同じ形の注文とカップ）、カードの組み立てと割当・移動・統合の書き込みは
// 本番と同じ @cafeore/common の関数（buildCaosCards・assignWrites など）と管制盤の操作（live/actions.ts）、
// 書き込みを当てるのと「次へ」は本番の API と同じ決まりの applyCaosPracticeWrites・advanceCaosPracticeDripper で行う。
// サーバー・本番の盤面・注文・在庫には何も送らない。

const createdMs = (order: HistoricalOrder) => Date.parse(order.createdAt);

export const usePracticeBoard = ({
  running,
  speed,
  baristas,
}: {
  running: boolean;
  speed: number;
  /** 列（1st〜6th） */
  baristas: Barista[];
}) => {
  const [session, setSession] = useState<TestPlaySession | null>(null);
  // 練習の盤面の注文（session.orders と同じ並び。カップに割当・抽出の値を持つ）
  const [practiceOrders, setPracticeOrders] = useState<CaosPracticeOrder[]>([]);
  // 書き込みを当てるときは最新の盤面に当てる（画面の再描画を待たずに続けて操作しても重ならないように）
  const practiceRef = useRef(practiceOrders);
  practiceRef.current = practiceOrders;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), ERROR_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  const status = session?.status;
  useEffect(() => {
    if (status !== "active" || !running) return;
    // 1 回で練習の時計を 1 秒進める。倍速は回す間隔で変える（時計・注文の到着・抽出の残りが同じ倍率で進む）
    const timer = window.setInterval(() => {
      setSession((current) =>
        current && current.status === "active"
          ? {
              ...current,
              currentMs: Math.min(current.endMs, current.currentMs + 1_000),
            }
          : current,
      );
    }, 1000 / speed);
    return () => window.clearInterval(timer);
  }, [status, running, speed]);

  // 届いた注文の数（作った順なので、先頭からこの数だけが盤面に出る）
  const currentMs = session?.currentMs;
  const arrivedCount = useMemo(() => {
    if (currentMs === undefined) return 0;
    const index = practiceOrders.findIndex(
      (order) => order.createdAt.getTime() > currentMs,
    );
    return index < 0 ? practiceOrders.length : index;
  }, [practiceOrders, currentMs]);
  const arrived = useMemo(
    () => practiceOrders.slice(0, arrivedCount),
    [practiceOrders, arrivedCount],
  );

  // 練習の日（日本時間）と、その日の 0 時（盤面の秒の起点）
  const startMs = session?.startMs;
  const day = startMs === undefined ? null : jstDate(startMs);
  const dayStartMs = startMs === undefined ? null : jstDayStart(startMs);
  const nowSec =
    currentMs === undefined || dayStartMs === null
      ? 0
      : Math.floor((currentMs - dayStartMs) / 1000);
  const cards = useMemo(
    () => (day === null ? [] : buildCaosCards(arrived, day)),
    [arrived, day],
  );
  const board = useMemo(
    () => cardsToBoard(cards, baristas, nowSec, dayStartMs ?? 0),
    [cards, baristas, nowSec, dayStartMs],
  );

  // 実績に出す注文（届いた分）。提供時間は練習の結果（抽出の要るカップが全部準備完了になった時刻）
  const orders = session?.orders;
  const salesOrders = useMemo<HistoricalOrder[]>(() => {
    if (!orders) return [];
    return orders.slice(0, arrivedCount).map((order, index) => {
      const brewCups = practiceOrders[index].cups.filter(cupNeedsBrew);
      const readyMs = brewCups.every((cup) => cup.readyAt !== null)
        ? Math.max(...brewCups.map((cup) => cup.readyAt?.getTime() ?? 0))
        : null;
      return {
        ...order,
        readyAt:
          brewCups.length > 0 && readyMs !== null
            ? new Date(readyMs).toISOString()
            : null,
        servedAt: null,
      };
    });
  }, [orders, practiceOrders, arrivedCount]);

  // 結果の盤面を入れる。断ったら理由を出す
  const commit = (result: CaosPracticeResult) => {
    if (result.error !== undefined) {
      setError(result.error);
      return;
    }
    practiceRef.current = result.orders;
    setPracticeOrders(result.orders);
  };
  const practiceNow = () => new Date(sessionRef.current?.currentMs ?? 0);

  const actions = caosBoardActions({
    cards,
    board,
    runWrites: (result: CaosWritesResult) => {
      if ("error" in result) {
        setError(result.error);
        return;
      }
      commit(
        applyCaosPracticeWrites(
          practiceRef.current,
          result.writes,
          practiceNow(),
        ),
      );
    },
    runNext: (dripper, dripId) =>
      commit(
        advanceCaosPracticeDripper(
          practiceRef.current,
          dripper,
          dripId,
          practiceNow(),
        ),
      ),
    setError,
  });

  /** 練習を始める。data は実データの注文（全部。ここで時間帯を切り出す） */
  const start = (
    data: HistoricalOrder[],
    startMs: number,
    durationMinutes: 30 | 60,
  ) => {
    const endMs = startMs + durationMinutes * 60_000;
    const inWindow = data
      .filter(
        (order) => createdMs(order) >= startMs && createdMs(order) < endMs,
      )
      .sort((a, b) => createdMs(a) - createdMs(b) || a.orderId - b.orderId);
    const board = inWindow.map((order, index) =>
      toCaosPracticeOrder(order, index),
    );
    practiceRef.current = board;
    setPracticeOrders(board);
    setError(null);
    setSession({
      status: "active",
      startMs,
      endMs,
      currentMs: startMs,
      durationMinutes,
      orders: inWindow,
    });
  };

  const finish = () =>
    setSession((current) =>
      current ? { ...current, status: "finished" } : current,
    );
  const reset = () => {
    practiceRef.current = [];
    setPracticeOrders([]);
    setError(null);
    setSession(null);
  };

  return {
    session,
    board,
    error,
    /** 練習の盤面の日の 0 時（盤面の秒の起点）。練習していなければ null */
    dayStartMs,
    salesOrders,
    ...actions,
    start,
    finish,
    reset,
  };
};
