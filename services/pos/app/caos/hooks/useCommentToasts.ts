import { useEffect, useLayoutEffect, useRef } from "react";
import { toast } from "sonner";
import { AUTHOR_MARKS } from "~/components/molecules/OrderInfoCard";
import { orderNoLabel } from "../logic/cards";
import { type CommentsByOrder, commentKey } from "../logic/comments";

/** コメントの通知を出しておく時間（ミリ秒） */
const TOAST_MS = 15_000;

/**
 * 注文に新しいコメントが付いたら、POS の通知（トースト）で知らせる（「表示」で onShow。その注文を探す）。
 * 画面を開いたとき（最初に注文が届いたとき）にもう付いていたコメントは知らせない。comments が null（実データテスト中など）のあいだは見ない
 */
export const useCommentToasts = (
  comments: CommentsByOrder | null,
  onShow: (orderNo: number) => void,
) => {
  const seen = useRef<Set<string> | null>(null);
  const show = useRef(onShow);
  useLayoutEffect(() => {
    show.current = onShow;
  });
  useEffect(() => {
    if (!comments) return;
    const all = [...comments.values()].flat();
    const known = seen.current;
    seen.current = new Set([...(known ?? []), ...all.map(commentKey)]);
    if (!known) return;
    for (const comment of all) {
      if (known.has(commentKey(comment))) continue;
      toast(`#${orderNoLabel(comment.orderNo)} にコメント`, {
        description: `${AUTHOR_MARKS[comment.author]}：${comment.text}`,
        duration: TOAST_MS,
        action: {
          label: "表示",
          onClick: () => show.current(comment.orderNo),
        },
      });
    }
  }, [comments]);
};
