import { useCallback, useEffect, useRef, useState } from "react";
import {
  type BoardChange,
  emptyBoard,
  receiveCards,
  restoreBoard,
} from "../logic/board";
import { tickBrewing } from "../logic/queue";
import type { Board, DripCard } from "../types";

type UndoSnapshot = {
  board: Board;
  label: string;
  /** 戻す操作のあとに届いたカード（戻しても消さない） */
  arrivals: DripCard[];
};

// 盤面の状態。操作（logic/board.ts）を当てる・届いたカードを足す・1つ戻す・抽出中の残りを減らすタイマー。
export const useBoardState = ({
  initial,
  isRunning,
  simSpeed,
}: {
  initial?: Board;
  isRunning: boolean;
  simSpeed: number;
}) => {
  const [board, setBoard] = useState<Board>(() => initial ?? emptyBoard());
  const undoRef = useRef<UndoSnapshot | null>(null);
  const [undoLabel, setUndoLabel] = useState<string | null>(null);

  // 抽出中のカードの残りを 1 秒ずつ減らす（速さはヘッダーの 1x〜10x）
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(
      () =>
        setBoard((prev) => ({
          ...prev,
          baristas: tickBrewing(prev.baristas, 1),
        })),
      1000 / simSpeed,
    );
    return () => window.clearInterval(timer);
  }, [isRunning, simSpeed]);

  /** 操作を当てる。できない操作なら false。今の盤面を「1つ戻す」の戻し先にする */
  const apply = (operation: (board: Board) => BoardChange) => {
    const change = operation(board);
    if (!change) return false;
    undoRef.current = { board, label: change.label, arrivals: [] };
    setUndoLabel(change.label);
    setBoard((prev) => operation(prev)?.board ?? prev);
    return true;
  };

  /** 届いたカードを未割当に足し、取り下げられたカード（isWithdrawn）を未割当から外す */
  const receive = useCallback(
    (incoming: DripCard[], isWithdrawn?: (card: DripCard) => boolean) => {
      undoRef.current?.arrivals.push(...incoming);
      setBoard((prev) => receiveCards(prev, incoming, isWithdrawn));
    },
    [],
  );

  /** 1つ戻す。戻したあとに届いたカードは残す */
  const undo = () => {
    const snapshot = undoRef.current;
    if (!snapshot) return false;
    setBoard(restoreBoard(snapshot.board, snapshot.arrivals));
    undoRef.current = null;
    setUndoLabel(null);
    return true;
  };

  /** 空の盤面に戻す（リセット・実データテストの開始） */
  const reset = () => {
    setBoard(emptyBoard());
    undoRef.current = null;
    setUndoLabel(null);
  };

  return { board, apply, receive, undo, undoLabel, reset };
};
