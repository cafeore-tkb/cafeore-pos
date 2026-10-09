import {
  type CaosCupsWrite,
  type CaosPracticeOrder,
  type CaosPracticeResult,
  type ItemType,
  type PracticeDataOrder,
  advanceCaosPracticeDripper,
  applyCaosPracticeWrites,
  buildCaosCards,
} from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  arrivedCount,
  ordersInPeriod,
  practiceSalesOrders,
  toPracticeOrders,
} from "../logic/historical";

/** 実データテスト。時間帯（startMs〜endMs）・練習の時計の今（currentMs）と、時間帯の注文（時刻の順） */
interface TestPlaySession {
  status: "active" | "finished";
  startMs: number;
  endMs: number;
  currentMs: number;
  orders: PracticeDataOrder[];
}

// 実データテスト（練習）。過去の注文の時刻を 1 秒ずつ進め（速さはヘッダーの 1x〜10x）、時刻が来た注文を練習の盤面に出す。
// 終わりの時刻に着いたら onTimeUp（タイマーを止める）。historicalOrders は読み込んだ実データの注文（usePracticeData）。
// 練習の盤面はブラウザの中だけで持ち（本番と同じ形の注文とカップ）、カードの組み立ては本番と同じ buildCaosCards、
// 操作の書き込みは本番と同じ @cafeore/common の assignWrites など（hooks/useCaosSession.ts）で作り、当てる（番号を決め、後ろをずらす）のと「次へ」は
// 本番の API と同じ決まりの @cafeore/common の applyCaosPracticeWrites・advanceCaosPracticeDripper で行う。時刻は練習の時計の今。
// サーバー・本番の盤面・注文・在庫には何も送らない。
export const useTestPlay = ({
  historicalOrders,
  itemTypes,
  isRunning,
  simSpeed,
  onTimeUp,
}: {
  historicalOrders: PracticeDataOrder[];
  /** POS の商品の種類（練習のカップの種類の表示名と ID を引く） */
  itemTypes: readonly ItemType[];
  isRunning: boolean;
  simSpeed: number;
  onTimeUp: () => void;
}) => {
  const [session, setSession] = useState<TestPlaySession | null>(null);
  // 練習の盤面の注文（session.orders と同じ並び。カップに割当・抽出の値を持つ）
  const [practiceOrders, setPracticeOrders] = useState<CaosPracticeOrder[]>([]);
  // 書き込みは最新の盤面に当てる（画面の再描画を待たずに続けて操作しても重ならないように）
  const practiceRef = useRef(practiceOrders);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const status = session?.status;
  const currentMs = session?.currentMs;
  const endMs = session?.endMs;

  // One test-play tick advances one second of historical time. The shared
  // speed control changes the tick frequency so the clock, timeline, order
  // arrivals, and brewing countdown all stay on the same multiplier.
  useEffect(() => {
    if (status !== "active" || !isRunning) return;
    const timer = window.setInterval(() => {
      setSession((prev) =>
        prev?.status === "active"
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

  // 時刻までに届いた注文からカードを組み立てる（練習の盤面は時間帯の注文だけを持つので、日では絞らない）
  const count = useMemo(
    () =>
      currentMs === undefined ? 0 : arrivedCount(practiceOrders, currentMs),
    [practiceOrders, currentMs],
  );
  const cards = useMemo(
    () => buildCaosCards(practiceOrders.slice(0, count)),
    [practiceOrders, count],
  );
  const orders = session?.orders;
  const salesOrders = useMemo(
    () => (orders ? practiceSalesOrders(orders, practiceOrders, count) : []),
    [orders, practiceOrders, count],
  );

  const replace = (next: CaosPracticeOrder[]) => {
    practiceRef.current = next;
    setPracticeOrders(next);
  };
  // 結果の盤面を入れる。断ったら理由を出して false
  const commit = (result: CaosPracticeResult) => {
    if (result.error !== undefined) {
      toast.error(result.error);
      return false;
    }
    replace(result.orders);
    return true;
  };
  const practiceNow = () => new Date(sessionRef.current?.currentMs ?? 0);

  return {
    session,
    cards,
    /** 実績に出す、届いた注文（提供時間は練習の結果） */
    salesOrders,
    runWrites: (writes: CaosCupsWrite[]) =>
      commit(
        applyCaosPracticeWrites(practiceRef.current, writes, practiceNow()),
      ),
    runNext: (dripper: number, dripId: string | null) =>
      commit(
        advanceCaosPracticeDripper(
          practiceRef.current,
          dripper,
          dripId,
          practiceNow(),
        ),
      ),
    /** 時間帯（startMs から durationMinutes 分）でテストを始める */
    start: (sessionStartMs: number, durationMinutes: 30 | 60) => {
      const sessionEndMs = sessionStartMs + durationMinutes * 60_000;
      const inPeriod = ordersInPeriod(
        historicalOrders,
        sessionStartMs,
        sessionEndMs,
      );
      replace(toPracticeOrders(inPeriod, itemTypes));
      setSession({
        status: "active",
        startMs: sessionStartMs,
        endMs: sessionEndMs,
        currentMs: sessionStartMs,
        orders: inPeriod,
      });
    },
    /** テストを終える（実績を見るために、リセットするまで盤面と時刻は残す） */
    finish: () =>
      setSession((prev) => (prev ? { ...prev, status: "finished" } : prev)),
    /** テストをやめる（練習の盤面は捨てる） */
    clear: () => {
      replace([]);
      setSession(null);
    },
  };
};
