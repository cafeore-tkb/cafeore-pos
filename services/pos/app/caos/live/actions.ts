import {
  type CaosCard,
  type CaosWritesResult,
  assignWrites,
  mergeWrites,
  unassignWrites,
} from "@cafeore/common";
import type { OrderTicket } from "../types";
import type { LiveBoard } from "./board";

// 管制盤の操作（割当・移動・未割当に戻す・統合・次へ）を、カードへの書き込みにする。
// 本番（useLiveCaosBoard。API に送る）と実データテスト（practice/usePracticeBoard。練習の盤面に当てる）で同じものを使い、
// 違うのは書き込みの送り先（runWrites）と「次へ」の送り先（runNext）だけ。

const newDripId = () => crypto.randomUUID();

export const caosBoardActions = ({
  cards,
  board,
  runWrites,
  runNext,
  setError,
}: {
  cards: readonly CaosCard[];
  board: LiveBoard;
  /** 書き込みを送る（作れなかったときの理由も渡す） */
  runWrites: (result: CaosWritesResult) => void;
  /** 「次へ」を送る。dripId は画面が抽出中と見ているカード（無いと見ているなら null） */
  runNext: (dripper: number, dripId: string | null) => void;
  setError: (error: string) => void;
}) => {
  // 画面のカード（ticketUid）から、組み立てたカードを引く
  const cardOf = (ticketUid: string | undefined) =>
    ticketUid ? board.cards.get(ticketUid) : undefined;

  return {
    /**
     * 割当・移動。place が "front" なら、そのドリッパーの待機の先頭へ。{ beforeTicketUid } なら、その待機のカードの前へ。
     * 無ければ待機の最後へ。送るのは「どのカードの前か」だけで、順番の数はサーバー（練習なら練習の盤面）が決める
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
      runWrites(
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
      if (card) runWrites(unassignWrites(card));
    },
    merge: (ticketUid: string, withTicketUid: string) => {
      const card = cardOf(ticketUid);
      const withCard = cardOf(withTicketUid);
      if (card && withCard) runWrites(mergeWrites(card, withCard, newDripId));
    },
    /**
     * 「次へ」。抽出中のカード（current）を付けて送る（二度押しやほかの端末と同時に押したときは断られる）。
     * 抽出中が無ければ（マスターで準備完了にして終わった、など）待機の先頭を始める
     */
    next: (dripper: number, current: OrderTicket | undefined) => {
      const card =
        current?.status === "brewing" ? cardOf(current.ticketUid) : undefined;
      runNext(dripper, card?.dripId ?? null);
    },
  };
};
