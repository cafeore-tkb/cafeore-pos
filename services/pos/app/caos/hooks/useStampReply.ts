import { type OrderComment, orderRepository } from "@cafeore/common";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { beginCaosReply, endCaosReply } from "../logic/caosReplies";

import { logCaosAsync } from "../utils/log";

/**
 * スタンプ・音声・自由記述を共通の送信処理で返す（その注文にマスターのコメントとして、スタンプの文字を付ける。POST /api/orders/{id}/comments）。
 * 付けたコメントは共有の WebSocket の注文で届き、ほかのコメントと同じく出る。送っているあいだはスタンプを押せない（二度押しで 2 つ付けない）。
 * 返したら onReply（応答を履歴へ表示し、その注文の新しいコメントの知らせを閉じる）。notifyFailure=falseでは呼び出し元が欄内に失敗を表示する。
 */
export const useStampReply = (
  onReply: (orderId: string, comment: OrderComment) => void,
) => {
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  return {
    /** 送っているあいだ */
    sending,
    send: async (
      orderId: string,
      stamp: string,
      options?: { notifyFailure?: boolean },
    ) => {
      if (busy.current || !stamp.trim()) return false;
      busy.current = true;
      setSending(true);
      const token = beginCaosReply(orderId, stamp);
      try {
        const comment = await logCaosAsync(
          "comment.stamp",
          { orderId, stamp },
          () => orderRepository.addComment(orderId, "master", stamp),
        );
        endCaosReply(token, comment);
        onReply(orderId, comment);
        return true;
      } catch {
        endCaosReply(token);
        if (options?.notifyFailure !== false)
          toast.error("コメントを送れませんでした。もう一度送信してください");
        return false;
      } finally {
        busy.current = false;
        setSending(false);
      }
    },
  };
};
