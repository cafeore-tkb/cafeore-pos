import {
  type CaosUndoEntry,
  type OrderEntity,
  type WithId,
  buildCaosCards,
  caosUndoCups,
  jstDate,
  undoCaosCups,
  undoOfOrderReady,
} from "@cafeore/common";
import { useRef } from "react";
import { toast } from "sonner";
import { UNDO_SEC } from "~/caos/hooks/useCaosUndo";

/**
 * 提供の画面で呼び出すと、サーバーがそのカップの抽出中の CaOS のカードの「次へ」を進め、統合したほかの注文のカップも準備完了にする。
 * 呼び出しをすぐ（CaOS の「1つ戻す」と同じ UNDO_SEC 秒のうちに）戻したら、その「次へ」もいっしょに戻す（@cafeore/common の undoOfOrderReady）。
 * それより後に戻したときは、呼び出しの取り消し（この注文のカップの準備完了を外す）だけにする
 */
export const useReadyAdvanceUndo = (
  orderId: string,
  orders: WithId<OrderEntity>[],
) => {
  const called = useRef<{ entry: CaosUndoEntry; atMs: number } | null>(null);
  return {
    /** 呼び出す前に呼ぶ */
    remember: () => {
      called.current = {
        entry: undoOfOrderReady(orders, orderId, jstDate(Date.now())),
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
        Date.now() - last.atMs > UNDO_SEC * 1000
      )
        return;
      const request = caosUndoCups(
        last.entry,
        buildCaosCards(orders, jstDate(Date.now())),
      );
      // arriving：「次へ」が進んでいない（全部のカップが呼び出す前のまま）
      const error =
        "error" in request
          ? !request.arriving && request.error
          : (await undoCaosCups(request.cups)).error;
      if (error) toast.error(`CaOS の「次へ」は戻せませんでした：${error}`);
    },
  };
};
