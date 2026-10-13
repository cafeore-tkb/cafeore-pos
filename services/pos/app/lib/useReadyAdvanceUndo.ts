import {
  CAOS_UNDO_SEC,
  type CaosUndoEntry,
  buildCaosCards,
  caosUndoCups,
  jstDate,
  undoCaosCups,
  undoOfOrderReady,
} from "@cafeore/common";
import { useRef } from "react";
import { toast } from "sonner";
import { useOrdersWSContext } from "~/routes/context/OrdersWSContext";

// 「次へ」の結果が盤面に届ききっていないとき、待って見直す間と回数
const ARRIVE_WAIT_MS = 300;
const ARRIVE_TRIES = 5;

/**
 * 提供の画面で呼び出すと、サーバーがそのカップの抽出中の CaOS のカードの「次へ」を進め、統合したほかの注文のカップも準備完了にする。
 * 呼び出しをすぐ（CaOS の「1つ戻す」と同じ CAOS_UNDO_SEC 秒のうちに）戻したら、その「次へ」もいっしょに戻す（@cafeore/common の undoOfOrderReady）。
 * それより後に戻したときは、呼び出しの取り消し（この注文のカップの準備完了を外す）だけにする
 */
export const useReadyAdvanceUndo = (orderId: string) => {
  const { orders } = useOrdersWSContext();
  // 押したときと待つあいだに届いた注文で見る
  const latest = useRef(orders);
  latest.current = orders;
  const called = useRef<{ entry: CaosUndoEntry; atMs: number } | null>(null);

  // 送るカップを作る。盤面がまだ「次へ」のあとになっていない（arriving・一部だけ届いて CHANGED）なら、少し待って見直す
  const undoRequest = async (entry: CaosUndoEntry) => {
    for (let tries = 1; ; tries++) {
      const request = caosUndoCups(
        entry,
        buildCaosCards(latest.current, jstDate(Date.now())),
      );
      if (!("error" in request)) return request;
      if (tries === ARRIVE_TRIES)
        return request.arriving
          ? { error: "「次へ」が進んでいないか、まだ届いていません" }
          : request;
      await new Promise((resolve) => setTimeout(resolve, ARRIVE_WAIT_MS));
    }
  };

  return {
    /** 呼び出す前に呼ぶ */
    remember: () => {
      called.current = {
        entry: undoOfOrderReady(latest.current, orderId, jstDate(Date.now())),
        atMs: Date.now(),
      };
    },
    /** 呼び出しを戻す前に呼ぶ。「次へ」を戻せなければ理由を通知で出す（呼び出しの取り消しはそのまま送る） */
    undo: async () => {
      const last = called.current;
      called.current = null;
      if (
        !last ||
        last.entry.cups.length === 0 ||
        Date.now() - last.atMs > CAOS_UNDO_SEC * 1000
      )
        return;
      const request = await undoRequest(last.entry);
      const error =
        "error" in request
          ? request.error
          : (await undoCaosCups(request.cups)).error;
      if (error) toast.error(`CaOS の「次へ」は戻せませんでした：${error}`);
    },
  };
};
