import { AUTHOR_MARKS } from "@cafeore/common";
import { ChevronRight, MessageSquareText, X } from "lucide-react";
import type React from "react";
import { createContext, useContext } from "react";
import { orderNoLabel } from "../logic/cards";
import { type BoardComment, commentKey } from "../logic/comments";

// 注文のコメント（レジなどで付けたもの）。カードの印と、開いたときの中身と、右下の置き場（選んだ注文のコメント・新しいコメントの知らせ）

/** コメントの印を押したときに、その注文（orderLabel）のコメントを右下の CommentDock に出す。操作の画面の盤面（App の ControlWorkspace）にだけ渡す（右のパネルは中身を出しているので渡さない）。無ければ印は押せない */
export const OpenCommentsContext = createContext<
  ((label: string) => void) | null
>(null);

/**
 * コメントのある注文のカードの印。カード（OrderCard）の左上の角に重ねる（className で置き場所と大きさを替える。D の統合したカードの段では小さく並べる）。
 * 押すと（OpenCommentsContext があれば）label の注文のコメントを右下に出す（カードを押したとき（掴む・開く）とは別。選択を外してもコメントを読めるように）
 */
export const CommentMark: React.FC<{
  count: number;
  /** 押したときにコメントを出す注文（orderLabel） */
  label: string;
  className?: string;
}> = ({
  count,
  label,
  className = "-top-2 -left-2 absolute z-20 h-7 w-7 border-2 border-white shadow-sm",
}) => {
  const open = useContext(OpenCommentsContext);
  const title = `コメント ${count}件`;
  const look = `bg-(color:--caos-comment) flex shrink-0 items-center justify-center rounded-full text-white ${className}`;
  const icon = <MessageSquareText className="h-3/5 w-3/5" />;
  if (!open)
    return (
      <span
        role="img"
        aria-label={title}
        title={title}
        className={`pointer-events-none ${look}`}
      >
        {icon}
      </span>
    );
  return (
    <button
      type="button"
      aria-label={`${title}を見る`}
      title={`${title}（押すと右下に出す）`}
      // カードの掴む・開くに渡さない
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        open(label);
      }}
      className={`touch-manipulation ${look}`}
    >
      {icon}
    </button>
  );
};

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

// 知らせは新しいものからこれだけ出す（ほかは「ほか N 件」）
const NOTICES_SHOWN = 3;

/**
 * 画面の右下に重ねるコメントの置き場（上はヘッダーの操作と右上の確かめがあるので避ける。右のパネルが開いていればその左。caos.css の .caos-comment-dock）。
 * 上に見ている注文（選んだ注文か、印を押した注文）のコメント（×で閉じる）、下に新しいコメントの知らせ（新しいものが下）。
 * 知らせは押すとその注文を開き（onOpen）、×で閉じる。どちらも押すまで残す
 */
export const CommentDock: React.FC<{
  /** 見ている注文（orderLabel）と、そのコメント */
  viewing?: { label: string; comments: readonly BoardComment[] };
  onCloseViewing: () => void;
  notices: readonly BoardComment[];
  onOpen: (comment: BoardComment) => void;
  onDismiss: (comments: readonly BoardComment[]) => void;
}> = ({ viewing, onCloseViewing, notices, onOpen, onDismiss }) => {
  const shown = notices.slice(-NOTICES_SHOWN);
  const hidden = notices.length - shown.length;
  if (notices.length === 0 && !viewing?.comments.length) return null;
  return (
    <div
      aria-live="polite"
      className="caos-comment-dock pointer-events-none fixed bottom-2 z-[150] flex w-[340px] flex-col gap-1.5"
    >
      {viewing && viewing.comments.length > 0 && (
        <section
          aria-label={`${viewing.label} のコメント`}
          className="border-(color:--caos-comment) pointer-events-auto rounded-lg border-2 bg-white p-1.5 shadow-lg"
        >
          <header className="mb-1 flex items-center gap-1 pl-1">
            <MessageSquareText className="text-(color:--caos-comment) h-3.5 w-3.5" />
            <h3 className="text-(color:--caos-comment) min-w-0 flex-1 truncate font-black text-[12px]">
              {viewing.label} のコメント
            </h3>
            <button
              type="button"
              onClick={onCloseViewing}
              aria-label="コメントを閉じる"
              className="flex h-7 w-8 shrink-0 touch-manipulation items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </header>
          <CommentList comments={viewing.comments} />
        </section>
      )}
      {hidden > 0 && (
        <div className="border-(color:--caos-comment) bg-(color:--caos-comment-soft) pointer-events-auto flex items-center justify-between rounded-lg border-2 px-2 py-1 font-black text-[12px] text-slate-700 shadow-lg">
          ほかに新しいコメント {hidden} 件
          <button
            type="button"
            onClick={() => onDismiss(notices)}
            className="h-7 touch-manipulation rounded-md border border-slate-300 bg-white px-2"
          >
            すべて閉じる
          </button>
        </div>
      )}
      {shown.map((comment) => (
        <div
          key={commentKey(comment)}
          className="border-(color:--caos-comment) bg-(color:--caos-comment-soft) pointer-events-auto flex items-stretch overflow-hidden rounded-lg border-2 shadow-lg"
        >
          <button
            type="button"
            onClick={() => onOpen(comment)}
            className="flex min-w-0 flex-1 touch-manipulation items-center gap-2 px-2 py-1.5 text-left"
          >
            <MessageSquareText className="text-(color:--caos-comment) h-5 w-5 shrink-0" />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block font-black text-[13px] text-slate-950">
                #{orderNoLabel(comment.orderNo)} に新しいコメント
              </span>
              <span className="block truncate font-bold text-[13px] text-slate-700">
                {AUTHOR_MARKS[comment.author]}：{comment.text}
              </span>
            </span>
            <span className="text-(color:--caos-comment) flex shrink-0 items-center font-black text-[12px]">
              開く
              <ChevronRight className="h-4 w-4" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => onDismiss([comment])}
            aria-label="閉じる"
            className="border-(color:--caos-comment) flex w-10 shrink-0 touch-manipulation items-center justify-center border-l text-slate-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
