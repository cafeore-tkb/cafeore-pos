import {
  type CaosWritesResult,
  buildCaosCards,
  jstDate,
  nextCaosDripper,
  putCaosCups,
} from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePosOrders } from "../hooks/usePosOrders";
import type { Barista } from "../types";
import { caosBoardActions } from "./actions";
import { cardsToBoard } from "./board";

// cafeore-pos の注文で動かす盤面（本番）。盤面は注文のカップの列（ドリッパー・順番・カード・抽出の時刻）で持つので、
// 共有の WebSocket の注文から今日（日本時間）のカードを組み立てる。操作はカップに書く（PUT /api/caos/cups・「次へ」）。
// 書いた注文は全部の画面に配られるので、複数の iPad で同じものを見て操作できる。結果は書いた注文の配信で届く。
// 断られたら（決まりに合わない・ほかの端末が先に書いた）理由を error に出す。
// enabled が false（実データテスト中）のときは注文を読まない。

export const ERROR_SHOWN_MS = 5000;

export const useLiveCaosBoard = ({
  enabled,
  baristas,
  now,
  nowSec,
  dayStartMs,
}: {
  enabled: boolean;
  /** 列（1st〜6th） */
  baristas: Barista[];
  now: Date;
  /** dayStartMs からの秒 */
  nowSec: number;
  dayStartMs: number;
}) => {
  const { orders, status } = usePosOrders(enabled);
  const today = jstDate(now.getTime());
  const cards = useMemo(
    () => buildCaosCards(orders ?? [], today),
    [orders, today],
  );
  const board = useMemo(
    () => cardsToBoard(cards, baristas, nowSec, dayStartMs),
    [cards, baristas, nowSec, dayStartMs],
  );
  // 「次へ」を送っている途中の列（応答が届く前の二度押しを止める）
  const pendingNextRef = useRef(new Set<number>());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(null), ERROR_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [error]);

  const runWrites = async (result: CaosWritesResult) => {
    if ("error" in result) {
      setError(result.error);
      return;
    }
    const { error } = await putCaosCups(result.writes);
    if (error) setError(error);
  };
  return {
    status,
    board,
    error,
    ...caosBoardActions({
      cards,
      board,
      runWrites: (result) => void runWrites(result),
      runNext: (dripper, dripId) => {
        if (pendingNextRef.current.has(dripper)) return;
        pendingNextRef.current.add(dripper);
        void nextCaosDripper(dripper, dripId)
          .then(({ error }) => {
            if (error) setError(error);
          })
          .finally(() => pendingNextRef.current.delete(dripper));
      },
      setError,
    }),
  };
};
