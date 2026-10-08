import { useEffect, useRef, useState } from "react";
import { startOfLocalDay } from "../logic/format";
import { ingestPosOrders } from "../logic/posOrders";
import type { DripCard } from "../types";
import { usePosOrders } from "./usePosOrders";

// cafeore-pos の注文を盤面に取り込む（共有の WebSocket から届くたびに、新しい注文を足し、取り下げを外す）。
// enabled が false（実データテスト中）のあいだは取り込まない。reset で取り込み直す。
export const usePosIngest = ({
  enabled,
  receive,
}: {
  enabled: boolean;
  receive: (
    incoming: DripCard[],
    isWithdrawn: (card: DripCard) => boolean,
  ) => void;
}) => {
  const { orders, status } = usePosOrders(enabled);
  // 取り込み済みの cafeore-pos 注文（UUID）
  const ingested = useRef<ReadonlySet<string>>(new Set());
  const [epoch, setEpoch] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: epoch はリセット後に取り込み直すための合図
  useEffect(() => {
    if (!enabled || !orders) return;
    const result = ingestPosOrders(
      orders,
      ingested.current,
      startOfLocalDay(Date.now()),
    );
    ingested.current = result.ingested;
    receive(result.incoming, result.isWithdrawn);
  }, [enabled, orders, epoch, receive]);

  return {
    status,
    /** 取り込み済みを忘れ、届いている注文を取り込み直す */
    reset: () => {
      ingested.current = new Set();
      setEpoch((value) => value + 1);
    },
  };
};
