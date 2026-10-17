import { orderRepository } from "@cafeore/common";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { beginCaosReply, endCaosReply } from "../logic/caosReplies";

import { logCaosAsync } from "../utils/log";

/**
 * コメントにスタンプで返す（その注文にマスターのコメントとして、スタンプの文字を付ける。POST /api/orders/{id}/comments）。
 * 付けたコメントは共有の WebSocket の注文で届き、ほかのコメントと同じく出る。送っているあいだはスタンプを押せない（二度押しで 2 つ付けない）。
 * 返したら onReply（その注文の新しいコメントの知らせを閉じる）
 */
export const useStampReply = (onReply: (orderId: string) => void) => {
  const [sending, setSending] = useState(false);
  const busy = useRef(false);
  return {
    /** 送っているあいだ */
    sending,
    send: async (orderId: string, stamp: string) => {
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
        onReply(orderId);
        return true;
      } catch {
        endCaosReply(token);
        toast.error("コメントを送れませんでした。もう一度送信してください");
        return false;
      } finally {
        busy.current = false;
        setSending(false);
      }
    },
  };
};
