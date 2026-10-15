import {
  type CaosCupsWrite,
  type CaosOutboxOp,
  type CaosUndoEntry,
  applyCaosOutboxOps,
  buildCaosCards,
  caosCardOfCup,
  caosUndoCups,
  jstDate,
  overlayCaosOrders,
} from "@cafeore/common";
import { useMemo, useRef } from "react";
import { toast } from "sonner";
import { enqueueCaosOp, useCaosOutboxEntries } from "./useCaosOutbox";
import { refuseUndo } from "./useCaosUndo";
import { usePosOrders } from "./usePosOrders";

/**
 * 「次へ」（抽出中のカードを終え、待機の先頭を始める）。dripId は画面が抽出中と見ているカード、startId は始めるカード（無ければ null）、
 * startNext が false なら終えるだけ
 */
export type CaosNextOp = Omit<Extract<CaosOutboxOp, { kind: "next" }>, "kind">;

// cafeore-pos の注文で動かす盤面（本番）。盤面は注文のカップの列（ドリッパー・順番・カード・抽出の時刻）で持つので、
// 共有の WebSocket の注文から今日（日本時間）のカードを組み立てる（@cafeore/common の buildCaosCards）。
// 画面を先に動かす：操作は押したらサーバーと同じ決まりで今の盤面に当ててみて（合わなければ理由を POS の通知で出して何もしない）、
// 合えばこの端末に残し（useCaosOutbox）、盤面はサーバーから届いた注文に残っている操作を重ねて出す（overlayCaosOrders）。
// 書き込み（PUT /api/caos/cups・「次へ」など）は後ろで 1 つずつ送り、書いた注文は全部の画面に配られる。
// enabled が false（実データテスト中）のときは注文を読まない（重ねもしない）。
export const useLiveBoard = ({
  enabled,
  nowMs,
}: {
  enabled: boolean;
  nowMs: number;
}) => {
  const { orders, status } = usePosOrders(enabled);
  const entries = useCaosOutboxEntries();
  const today = jstDate(nowMs);
  const board = useMemo(
    () => (orders ? overlayCaosOrders(orders, entries, today) : []),
    [orders, today, entries],
  );
  const cards = useMemo(() => buildCaosCards(board), [board]);
  // 押した操作は押したときの盤面に当てる
  const latest = useRef({ board, cards });
  latest.current = { board, cards };

  // 操作（ops は続けて当てる）を今の盤面に当ててみて、合えば端末に残す（画面はすぐ変わる）。合わなければ理由を通知で出して false
  const run = (label: string, ...ops: CaosOutboxOp[]) => {
    const { error } = applyCaosOutboxOps(latest.current.board, ops, new Date());
    if (error !== undefined) {
      toast.error(error);
      return false;
    }
    for (const op of ops) enqueueCaosOp(label, op);
    return true;
  };

  return {
    status,
    /** 注文（緊急のシールの中身を作る） */
    orders,
    cards,
    /** 書き込みを送る。決まりに合えば true（画面はすぐ変わり、送るのは後ろで） */
    runWrites: (writes: CaosCupsWrite[], label: string) =>
      run(label, { kind: "cups", writes }),
    /** 「次へ」を送る。before は先に当てる書き込み（押した待機のカードを待機の先頭へ）。決まりに合えば true */
    runNext: (next: CaosNextOp, label: string, before: CaosCupsWrite[] = []) =>
      run(
        label,
        ...(before.length > 0
          ? [{ kind: "cups", writes: before } as const]
          : []),
        { kind: "next", ...next },
      ),
    /** カップ（入れ直しも。ids）が盤面に届いたか */
    arrived: (ids: string[]) =>
      ids.every((id) => caosCardOfCup(latest.current.cards, id)),
    /** 緊急（入れ直し）を取り消す（まだ抽出を始めていないものだけ）。全部取り消せたら true */
    cancelEmergencies: (ids: string[], label: string) =>
      run(
        label,
        ...ids.map((id) => ({ kind: "cancel-emergency", id }) as const),
      ),
    /** 操作（entry）を「1つ戻す」処理。盤面のカップがその操作のあとのままなら、操作の前の値に書き戻す */
    undoRun: (entry: CaosUndoEntry, label: string) => () => {
      const request = caosUndoCups(entry, latest.current.cards);
      if ("error" in request) return refuseUndo(request);
      return run(`戻す（${label}）`, { kind: "undo", entry });
    },
  };
};
