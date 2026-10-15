import {
  type CaosCupsWrite,
  type CaosPracticeOrder,
  type CaosPracticeResult,
  type ItemType,
  type PracticeDataOrder,
  addCaosPracticeEmergencies,
  advanceCaosPracticeDripper,
  applyCaosPracticeWrites,
  buildCaosCards,
  cancelCaosPracticeEmergency,
} from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  arrivedCount,
  ordersInPeriod,
  practiceSalesOrders,
  toPracticeOrders,
  withPracticeItemTypes,
} from "../logic/historical";
import type { CaosNextOp } from "./useLiveBoard";

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
// 緊急（入れ直し）も練習の盤面の中だけで足し・取り消す（addCaosPracticeEmergencies・cancelCaosPracticeEmergency。シールは刷らない）。
// サーバー・本番の盤面・注文・在庫・印刷には何も送らない。
export const useTestPlay = ({
  historicalOrders,
  itemTypes,
  isRunning,
  simSpeed,
  onTimeUp,
}: {
  historicalOrders: PracticeDataOrder[];
  /** POS の商品の種類（実データの品物の種類の設定と、練習のカップの種類の ID を引く） */
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
  const arrivedOrders = useMemo(
    () => practiceOrders.slice(0, count),
    [practiceOrders, count],
  );
  const cards = useMemo(() => buildCaosCards(arrivedOrders), [arrivedOrders]);
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
    // before（押した待機のカードを待機の先頭へ）を当ててから「次へ」
    runNext: (
      { dripper, dripId, startNext }: CaosNextOp,
      _label: string,
      before: CaosCupsWrite[] = [],
    ) => {
      const moved = applyCaosPracticeWrites(
        practiceRef.current,
        before,
        practiceNow(),
      );
      return commit(
        moved.error !== undefined
          ? moved
          : advanceCaosPracticeDripper(
              moved.orders,
              dripper,
              dripId,
              practiceNow(),
              { startNext },
            ),
      );
    },
    /** 届いた注文（緊急の入力で番号から選ぶ） */
    arrivedOrders,
    /** 緊急（入れ直し）を足す（理由・決まりは本番と同じ。足した時刻は練習の時計の今）。足した入れ直しの id。断ったら理由を出して null */
    addEmergencies: (cupIds: string[], reason: string) => {
      const result = addCaosPracticeEmergencies(
        practiceRef.current,
        cupIds,
        reason,
        practiceNow(),
        () => crypto.randomUUID(),
      );
      if ("error" in result) {
        toast.error(result.error);
        return null;
      }
      replace(result.orders);
      return result.ids;
    },
    /** 緊急（入れ直し）を取り消す（まだ抽出を始めていないものだけ）。全部取り消せたら true。断ったら理由を出して何も変えない */
    cancelEmergencies: (ids: string[]) => {
      let orders = practiceRef.current;
      for (const id of ids) {
        const result = cancelCaosPracticeEmergency(orders, id);
        if (result.error !== undefined) return commit(result);
        orders = result.orders;
      }
      return commit({ orders });
    },
    /** 時間帯（startMs から durationMinutes 分）でテストを始める */
    start: (sessionStartMs: number, durationMinutes: 30 | 60) => {
      const sessionEndMs = sessionStartMs + durationMinutes * 60_000;
      // 品物に種類の設定を付けてから、盤面（カップにするか・抽出が要るか）と実績（杯数）に使う
      const inPeriod = withPracticeItemTypes(
        ordersInPeriod(historicalOrders, sessionStartMs, sessionEndMs),
        itemTypes,
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
