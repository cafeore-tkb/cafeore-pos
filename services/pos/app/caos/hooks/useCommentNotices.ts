import { useEffect, useRef, useState } from "react";
import {
  type BoardComment,
  type CommentsByOrder,
  commentKey,
} from "../logic/comments";
import { soundManager } from "../utils/audio";

/**
 * 注文に付いた新しいコメントの知らせ（画面の右下の CommentDock に出す）。見落とさないよう、届いたら音を鳴らし（ヘッダーの音の切り替えに従う）、
 * 押す（その注文を開く）か閉じるまで残す。画面を開いたとき（最初に注文が届いたとき）にもう付いていたコメントは知らせない。
 * comments が null（実データテスト中など）のあいだは見ない
 */
export const useCommentNotices = (comments: CommentsByOrder | null) => {
  const seen = useRef<Set<string> | null>(null);
  const [notices, setNotices] = useState<readonly BoardComment[]>([]);
  useEffect(() => {
    if (!comments) return;
    const all = [...comments.values()].flat();
    // 最初に届いたときは、見た印を付けるだけ
    if (!seen.current) {
      seen.current = new Set(all.map(commentKey));
      return;
    }
    const known = seen.current;
    const fresh = all.filter((comment) => !known.has(commentKey(comment)));
    if (fresh.length === 0) return;
    for (const comment of fresh) known.add(commentKey(comment));
    setNotices((list) => [...list, ...fresh]);
    soundManager.playComment();
  }, [comments]);
  return {
    notices,
    /** 知らせを消す（押した・閉じた） */
    dismiss: (dismissed: readonly BoardComment[]) =>
      setNotices((list) => list.filter((c) => !dismissed.includes(c))),
  };
};

/**
 * 右下にコメントを出す注文（orderLabel）。カードの印を押した注文（閉じるか、ほかの注文を選ぶまで。選択を外しても残す）か、選んでいる注文
 */
export const useViewedComments = (selectedOrderId: string | null) => {
  const [pinned, setPinned] = useState<string | null>(null);
  // ほかの注文を選んだら、印を押した注文はやめて選んだ注文を出す
  useEffect(() => {
    if (selectedOrderId !== null) setPinned(null);
  }, [selectedOrderId]);
  return {
    label: pinned ?? selectedOrderId,
    /** 印を押した注文のコメントを出す */
    open: setPinned,
    /** 閉じる（印を押した注文をやめる） */
    close: () => setPinned(null),
  };
};
