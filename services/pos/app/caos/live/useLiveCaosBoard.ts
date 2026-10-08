import {
  type CaosWritesResult,
  assignWrites,
  buildCaosCards,
  jstDate,
  mergeWrites,
  nextCaosDripper,
  putCaosCups,
  unassignWrites,
  useColorSettings,
} from "@cafeore/common";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBeanInventory } from "../hooks/useBeanInventory";
import { usePosOrders } from "../hooks/usePosOrders";
import type { Barista, OrderTicket } from "../types";
import { cardsToBoard } from "./board";

// cafeore-pos の注文で動かす盤面（本番）。盤面は注文のカップの列（ドリッパー・順番・カード・抽出の時刻）で持つので、
// 共有の WebSocket の注文から今日（日本時間）のカードを組み立てる。操作はカップに書く（PUT /api/caos/cups・「次へ」）。
// 書いた注文は全部の画面に配られるので、複数の iPad で同じものを見て操作できる。結果は書いた注文の配信で届く。
// 断られたら（決まりに合わない・ほかの端末が先に書いた）理由を error に出す。
// カードの色は色の設定、豆は POS の在庫（「商品 → 豆」と残量）をそのまま使う。CaOS は在庫を持たず、減らしもしない。
// enabled が false（実データテスト中）のときは注文と色の設定を読まない。
// 閲覧だけの画面（ReadOnlyBoard.tsx）も同じ盤面を使い、操作（assign など）だけ使わない。

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
  const { colorSettings } = useColorSettings(enabled);
  const { beanStatuses, beanIndex, ...beanState } = useBeanInventory();
  const board = useMemo(
    () =>
      cardsToBoard(
        cards,
        baristas,
        nowSec,
        dayStartMs,
        colorSettings,
        beanIndex,
      ),
    [cards, baristas, nowSec, dayStartMs, colorSettings, beanIndex],
  );
  // 盤面にある（未割当・待機・抽出中の）杯数（豆＝在庫対象の ID ごと）。豆のパネルに出す
  const beanWaitingCups = useMemo(() => {
    const cups = new Map<string, number>(
      beanStatuses.map((status) => [status.resource.id, 0]),
    );
    const waiting = [
      ...board.unassignedOrders,
      ...board.baristas.flatMap((barista) => barista.queue),
    ];
    for (const card of waiting) {
      for (const bean of card.beans ?? []) {
        cups.set(bean.id, (cups.get(bean.id) ?? 0) + card.cupCount);
      }
    }
    return cups;
  }, [board, beanStatuses]);
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
    /** 豆のパネルに出す POS の在庫（豆だけ）と、盤面にある杯数 */
    beans: {
      statuses: beanStatuses,
      waitingCups: beanWaitingCups,
      ...beanState,
    },
    /** 割当・移動。toFront なら、そのドリッパーの待機の先頭へ */
    assign: (
      ticketUid: string | undefined,
      dripper: number,
      toFront = false,
    ) => {
      const card = cardOf(ticketUid);
      if (!card) return;
      void runWrites(
        assignWrites(cards, card, dripper, {
          index: toFront ? 0 : undefined,
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
