import {
  type CaosWritesResult,
  assignWrites,
  buildCaosCards,
  jstDate,
  mergeWrites,
  nextCaosDripper,
  putCaosCups,
  unassignWrites,
} from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePosOrders } from "../hooks/usePosOrders";
import type { Barista, OrderTicket } from "../types";
import { cardsToBoard } from "./board";

// cafeore-pos の注文で動かす盤面（本番）。盤面は注文のカップの列（ドリッパー・順番・カード・抽出の時刻）で持つので、
// 共有の WebSocket の注文から今日（日本時間）のカードを組み立てる。操作はカップに書く（PUT /api/caos/cups・「次へ」）。
// 書いた注文は全部の画面に配られるので、複数の iPad で同じものを見て操作できる。結果は書いた注文の配信で届く。
// 断られたら（決まりに合わない・ほかの端末が先に書いた）理由を error に出す。
// enabled が false（実データテスト中）のときは注文を読まない。

const ERROR_SHOWN_MS = 5000;

const newDripId = () => crypto.randomUUID();

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
  // 画面のカード（ticketUid）から、組み立てたカードを引く
  const cardOf = (ticketUid: string | undefined) =>
    ticketUid ? board.cards.get(ticketUid) : undefined;

  return {
    status,
    board,
    error,
    /**
     * 割当・移動。place が "front" なら、そのドリッパーの待機の先頭へ。{ beforeTicketUid } なら、その待機のカードの前へ。
     * 無ければ待機の最後へ。送るのは「どのカードの前か」だけで、順番の数はサーバーが決める
     */
    assign: (
      ticketUid: string | undefined,
      dripper: number,
      place?: "front" | { beforeTicketUid: string },
    ) => {
      const card = cardOf(ticketUid);
      if (!card) return;
      const beforeCard =
        place && place !== "front" ? cardOf(place.beforeTicketUid) : undefined;
      if (place && place !== "front" && !beforeCard) {
        setError("前に入れるカードが見つかりません");
        return;
      }
      void runWrites(
        assignWrites(cards, card, dripper, {
          place:
            place === "front"
              ? "front"
              : beforeCard
                ? { beforeKey: beforeCard.key }
                : undefined,
          newId: newDripId,
        }),
      );
    },
    unassign: (ticketUid: string | undefined) => {
      const card = cardOf(ticketUid);
      if (card) void runWrites(unassignWrites(card));
    },
    merge: (ticketUid: string, withTicketUid: string) => {
      const card = cardOf(ticketUid);
      const withCard = cardOf(withTicketUid);
      if (card && withCard)
        void runWrites(mergeWrites(card, withCard, newDripId));
    },
    /**
     * 「次へ」。抽出中のカード（current）を付けて送る（二度押しやほかの端末と同時に押したときは、サーバーが断る）。
     * 抽出中が無ければ（マスターで準備完了にして終わった、など）待機の先頭を始める
     */
    next: (dripper: number, current: OrderTicket | undefined) => {
      if (pendingNextRef.current.has(dripper)) return;
      const card =
        current?.status === "brewing" ? cardOf(current.ticketUid) : undefined;
      pendingNextRef.current.add(dripper);
      void nextCaosDripper(dripper, card?.dripId ?? null)
        .then(({ error }) => {
          if (error) setError(error);
        })
        .finally(() => pendingNextRef.current.delete(dripper));
    },
  };
};
