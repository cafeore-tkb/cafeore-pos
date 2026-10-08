import {
  type CaosCupsWrite,
  type CaosPracticeOrder,
  type ItemType,
  type PracticeDataOrder,
  advanceCaosPracticeDripper,
  applyCaosPracticeWrites,
  caosDay,
  practiceItemType,
  startOfJstDay,
  toCaosPracticeOrder,
} from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PracticeSalesOrder } from "../types";

// 実データテスト（練習）の盤面。読み込んだ実データの注文を、練習の時計（1〜10 倍速）に合わせて届いた順に盤面に出す。
// 盤面はブラウザの中だけで持ち（本番と同じ形の注文とカップ）、カードの組み立てと割当・移動・統合の書き込みは
// 本番と同じ @cafeore/common の関数（buildCaosCards・assignWrites など）、書き込みを当てるのと「次へ」は
// 本番のサーバーと同じ決まりの applyCaosPracticeWrites・advanceCaosPracticeDripper で行う。
// サーバー・本番の盤面・注文・在庫には何も送らない。

export interface PracticeStart {
  /** どのデータか（例「2025年の実績」） */
  label: string;
  /** 読み込んだ実データの注文（全部。ここで時間帯を切り出す） */
  orders: PracticeDataOrder[];
  startMs: number;
  endMs: number;
  /** DB の今の商品の種類（取れなければ空。品物の種類の決め方は practiceItemType） */
  itemTypes: ItemType[];
}

export interface PracticeSession {
  status: "active" | "finished";
  label: string;
  startMs: number;
  endMs: number;
  /** 練習の時計の今 */
  currentMs: number;
  /** 時間帯の実データの注文（作った順） */
  data: PracticeDataOrder[];
  /** 練習の盤面の注文（data と同じ並び。カップに割当・抽出の値を持つ） */
  board: CaosPracticeOrder[];
  /** 実績に使う品物の種類（data の注文ごと・品物ごと） */
  itemTypes: ItemType[][];
}

const createdMs = (order: PracticeDataOrder) => Date.parse(order.createdAt);

export const usePracticeBoard = ({
  running,
  speed,
}: {
  running: boolean;
  speed: number;
}) => {
  const [session, setSession] = useState<PracticeSession | null>(null);
  // 書き込みを当てるときは最新の盤面に当てる（画面の再描画を待たずに続けて操作しても重ならないように）
  const sessionRef = useRef(session);
  sessionRef.current = session;

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
  const arrivedCount = useMemo(() => {
    if (!session) return 0;
    const index = session.board.findIndex(
      (order) => order.createdAt.getTime() > session.currentMs,
    );
    return index < 0 ? session.board.length : index;
  }, [session]);
  const board = session?.board;
  const orders = useMemo(
    () => (board ? board.slice(0, arrivedCount) : []),
    [board, arrivedCount],
  );

  // 実績に出す注文（届いた分）。提供時間は練習の結果（抽出の要るカップが全部準備完了になった時刻）
  const data = session?.data;
  const itemTypes = session?.itemTypes;
  const salesOrders = useMemo<PracticeSalesOrder[]>(() => {
    if (!data || !board || !itemTypes) return [];
    return data.slice(0, arrivedCount).map((order, index) => {
      const brewCups = board[index].cups.filter(
        (cup) => cup.item.item_type.needs_brew !== false,
      );
      const readyMs = brewCups.every((cup) => cup.readyAt !== null)
        ? Math.max(...brewCups.map((cup) => cup.readyAt?.getTime() ?? 0))
        : null;
      return {
        orderId: order.orderId,
        createdAt: order.createdAt,
        readyAt:
          brewCups.length > 0 && readyMs !== null
            ? new Date(readyMs).toISOString()
            : null,
        billingAmount: order.billingAmount,
        items: order.items.map((item, itemIndex) => {
          const type = itemTypes[index][itemIndex];
          return {
            name: item.name,
            price: item.price,
            type: type.name,
            typeLabel: type.display_name,
            makesCup: type.makes_cup !== false,
          };
        }),
      };
    });
  }, [data, board, itemTypes, arrivedCount]);

  const start = ({
    label,
    orders,
    startMs,
    endMs,
    itemTypes,
  }: PracticeStart) => {
    const inWindow = orders
      .filter(
        (order) => createdMs(order) >= startMs && createdMs(order) < endMs,
      )
      .sort((a, b) => createdMs(a) - createdMs(b) || a.orderId - b.orderId);
    setSession({
      status: "active",
      label,
      startMs,
      endMs,
      currentMs: startMs,
      data: inWindow,
      board: inWindow.map((order, index) =>
        toCaosPracticeOrder(order, index, itemTypes),
      ),
      itemTypes: inWindow.map((order) =>
        order.items.map((item) => practiceItemType(item, itemTypes).itemType),
      ),
    });
  };

  // 結果の盤面を、時計を進めた分と合わせて入れる
  const commit = (next: CaosPracticeOrder[]) => {
    const current = sessionRef.current;
    if (current) sessionRef.current = { ...current, board: next };
    setSession((prev) => (prev ? { ...prev, board: next } : prev));
  };

  /** 書き込み（assignWrites などで作ったもの）を練習の盤面に当てる。断ったら理由を返す */
  const apply = (writes: CaosCupsWrite[]): string | null => {
    const current = sessionRef.current;
    if (!current) return "練習をしていません";
    const result = applyCaosPracticeWrites(
      current.board,
      writes,
      new Date(current.currentMs),
    );
    if (result.error !== undefined) return result.error;
    commit(result.orders);
    return null;
  };

  /** 「次へ」。dripId は画面が抽出中と見ているカード。断ったら理由を返す */
  const next = (dripper: number, dripId: string | null): string | null => {
    const current = sessionRef.current;
    if (!current) return "練習をしていません";
    const result = advanceCaosPracticeDripper(
      current.board,
      dripper,
      dripId,
      new Date(current.currentMs),
    );
    if (result.error !== undefined) return result.error;
    commit(result.orders);
    return null;
  };

  const finish = () =>
    setSession((current) =>
      current ? { ...current, status: "finished" } : current,
    );
  const reset = () => setSession(null);

  return {
    session,
    /** 盤面に出ている（届いた）注文 */
    orders,
    /** 練習の盤面の日（日本時間）と、その日の始まり（盤面の秒の起点） */
    day: session ? caosDay(new Date(session.startMs)) : null,
    dayStartMs: session ? startOfJstDay(session.startMs) : null,
    salesOrders,
    start,
    apply,
    next,
    finish,
    reset,
  };
};
