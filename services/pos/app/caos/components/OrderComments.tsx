import { AUTHOR_MARKS } from "@cafeore/common";
import { MessageSquareText } from "lucide-react";
import type React from "react";
import { orderNoLabel } from "../logic/cards";
import { type BoardComment, commentKey } from "../logic/comments";

// 注文のコメント（レジなどで付けたもの）。カードの印と、開いたときの中身

/** コメントのある注文のカードの印。カード（OrderCard）の左上の角に重ねる（className で置き場所と大きさを替える。D の統合したカードの段では小さく並べる） */
export const CommentMark: React.FC<{ count: number; className?: string }> = ({
  count,
  className = "-top-2 -left-2 absolute z-20 h-6 w-6 border-2 border-white shadow-sm",
}) => (
  <span
    role="img"
    aria-label={`コメント ${count}件`}
    title={`コメント ${count}件`}
    className={`bg-(color:--caos-comment) pointer-events-none flex shrink-0 items-center justify-center rounded-full text-white ${className}`}
  >
    <MessageSquareText className="h-3/5 w-3/5" />
  </span>
);

/** コメントの中身（付けた順。書き手は POS と同じ 1 文字）。いくつかの注文のコメントなら注文番号も出す */
export const CommentList: React.FC<{
  comments?: readonly BoardComment[];
  className?: string;
}> = ({ comments = [], className = "" }) => {
  if (comments.length === 0) return null;
  const withNo = new Set(comments.map((c) => c.orderNo)).size > 1;
  return (
    <ul className={`grid gap-1 ${className}`}>
      {comments.map((comment) => (
        <li
          key={commentKey(comment)}
          className="border-(color:--caos-comment) bg-(color:--caos-comment-soft) flex items-start gap-2 rounded-lg border px-2 py-1.5 font-bold text-[14px] text-slate-900"
        >
          <MessageSquareText className="text-(color:--caos-comment) mt-0.5 h-4 w-4 shrink-0" />
          <span className="shrink-0 font-black">
            {withNo && `#${orderNoLabel(comment.orderNo)} `}
            {AUTHOR_MARKS[comment.author]}
          </span>
          <span className="min-w-0 break-words">{comment.text}</span>
        </li>
      ))}
    </ul>
  );
};

/** コメントの中身を 1 行で（管制盤 A の選んだ注文の帯、C・D で開いた未割当のカードの見出し）。入らなければ省略し、全部は title に */
export const CommentLine: React.FC<{
  comments: readonly BoardComment[];
  /** 文字の大きさなど（A の帯は帯の文字のまま） */
  className?: string;
}> = ({ comments, className = "" }) => {
  if (comments.length === 0) return null;
  const text = comments
    .map((comment) => `${AUTHOR_MARKS[comment.author]} ${comment.text}`)
    .join(" / ");
  return (
    <span
      title={text}
      className={`text-(color:--caos-comment) flex min-w-0 items-center gap-1 rounded bg-white px-2 py-0.5 ${className}`}
    >
      <MessageSquareText className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </span>
  );
};
