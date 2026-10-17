import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  caosRepliesRevision,
  isPendingCaosReply,
  isSentCaosReply,
  subscribeCaosReplies,
} from "../logic/caosReplies";
import { labelHasOrder } from "../logic/cards";
import {
  type BoardComment,
  type CommentsByOrder,
  commentKey,
  isStampReply,
} from "../logic/comments";
import { soundManager } from "../utils/audio";

// 知らせから gone のものを除く（無ければそのまま。描き直さない）
const without =
  (gone: (comment: BoardComment) => boolean) =>
  (list: readonly BoardComment[]) =>
    list.some(gone) ? list.filter((comment) => !gone(comment)) : list;

/**
 * 注文に付いた新しいコメントの知らせ（画面の右下の CommentDock に出す）。見落とさないよう、届いたら音を鳴らし（ヘッダーの音の切り替えに従う）、
 * 押す（その注文を開く）か閉じるか、その注文を見る（viewedLabel。選ぶ・印を押す・番号で探す）まで残す。
 * 画面を開いたとき（最初に注文が届いたとき）にもう付いていたコメントと、CaOS から返したスタンプ（isStampReply）は知らせない。
 * comments が null（実データテスト中など）のあいだは見ない
 */
export const useCommentNotices = (
  comments: CommentsByOrder | null,
  viewedLabel: string | null,
) => {
  const replyRevision = useSyncExternalStore(
    subscribeCaosReplies,
    caosRepliesRevision,
    () => 0,
  );
  const seen = useRef<Set<string> | null>(null);
  const viewed = useRef(viewedLabel);
  useLayoutEffect(() => {
    viewed.current = viewedLabel;
  });
  const [notices, setNotices] = useState<readonly BoardComment[]>([]);
  useEffect(() => {
    void replyRevision;
    if (!comments) return;
    const all = [...comments.values()].flat();
    // 最初に届いたときは、見た印を付けるだけ
    if (!seen.current) {
      seen.current = new Set(all.map(commentKey));
      return;
    }
    const known = seen.current;
    const added = all.filter(
      (comment) =>
        !known.has(commentKey(comment)) && !isPendingCaosReply(comment),
    );
    for (const comment of added) known.add(commentKey(comment));
    const fresh = added.filter(
      (comment) => !isStampReply(comment) && !isSentCaosReply(comment),
    );
    if (fresh.length === 0) return;
    soundManager.playComment();
    // 今見ている注文のコメントは、右下の見ている注文の欄に出ている
    setNotices((list) => [
      ...list,
      ...fresh.filter(
        (comment) => !labelHasOrder(viewed.current, comment.orderNo),
      ),
    ]);
  }, [comments, replyRevision]);
  // その注文を見たら、知らせは消す
  useEffect(() => {
    if (viewedLabel)
      setNotices(
        without((comment) => labelHasOrder(viewedLabel, comment.orderNo)),
      );
  }, [viewedLabel]);
  return {
    notices,
    /** 知らせを消す（押した・閉じた） */
    dismiss: (dismissed: readonly BoardComment[]) => {
      const keys = new Set(dismissed.map(commentKey));
      setNotices(without((comment) => keys.has(commentKey(comment))));
    },
  };
};
