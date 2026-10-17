import { orderRepository } from "@cafeore/common";
import { useState } from "react";
import { toast } from "sonner";

import { logCaosAsync } from "../utils/log";

/**
 * コメントにスタンプで返す（その注文にマスターのコメントとして、スタンプの文字を付ける。POST /api/orders/{id}/comments）。
 * 付けたコメントは共有の WebSocket の注文で届き、ほかのコメントと同じく出る。送っているあいだはスタンプを押せない（二度押しで 2 つ付けない）。
 * 返したら onReply（その注文の新しいコメントの知らせを閉じる）
 */
export const useStampReply = (onReply: (orderId: string) => void) => {
  const [sending, setSending] = useState(false);
  return {
    /** 送っているあいだ */
    sending,
    send: async (orderId: string, stamp: string) => {
      if (sending) return;
      setSending(true);
      try {
        await logCaosAsync("comment.stamp", { orderId, stamp }, () =>
          orderRepository.addComment(orderId, "master", stamp),
        );
        onReply(orderId);
      } catch {
        toast.error(`スタンプ「${stamp}」を送れませんでした`);
      } finally {
        setSending(false);
      }
    },
  };
};
