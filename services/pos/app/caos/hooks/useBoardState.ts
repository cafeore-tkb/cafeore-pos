import { useCallback, useEffect, useRef, useState } from "react";
import { type BoardChange, emptyBoard, receiveCards } from "../logic/board";
import { tickBrewing } from "../logic/queue";
import type { Board, DripCard } from "../types";

// 盤面の状態。操作（logic/board.ts）を当てる・届いたカードを足す・抽出中の残りを減らすタイマー。
// 盤面は ref でも持ち、どの変更も ref の最新の盤面から次の盤面を作る（同じ描画のうちに操作が 2 つ来ても、
// 2 つ目は 1 つ目のあとの盤面に当たり、できたかどうか（音を鳴らすか）もその盤面で決まる）。
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
  const boardRef = useRef(board);
  const commit = useCallback((next: Board) => {
    boardRef.current = next;
    setBoard(next);
  }, []);

  // 抽出中のカードの残りを 1 秒ずつ減らす（速さはヘッダーの 1x〜10x）
  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(
      () =>
        commit({
          ...boardRef.current,
          baristas: tickBrewing(boardRef.current.baristas),
        }),
      1000 / simSpeed,
    );
    return () => window.clearInterval(timer);
  }, [isRunning, simSpeed, commit]);

  /** 操作を当てる。できない操作なら false */
  const apply = (operation: (board: Board) => BoardChange) => {
    const next = operation(boardRef.current);
    if (!next) return false;
    commit(next);
    return true;
  };

  /** 届いたカードを未割当に足し、取り下げられた注文（withdrawn）のカードを未割当から外す */
  const receive = useCallback(
    (incoming: DripCard[], withdrawn?: ReadonlySet<string>) => {
      const next = receiveCards(boardRef.current, incoming, withdrawn);
      if (next !== boardRef.current) commit(next);
    },
    [commit],
  );

  /** 空の盤面に戻す（リセット・実データテストの開始） */
  const reset = () => commit(emptyBoard());

  return { board, apply, receive, reset };
};
