import { jstClock } from "@cafeore/common";
import { ArrowLeft, MessageSquareText } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { orderNoLabel } from "../logic/cards";
import {
  type BoardComment,
  commentKey,
  commentReaction,
} from "../logic/comments";
import { StampBar } from "./OrderComments";
import { ReactionIcon } from "./ReactionIcon";

const AUTHORS: Record<BoardComment["author"], string> = {
  master: "マスター",
  cashier: "レジ",
  serve: "提供",
  others: "その他",
};

/** Cの右側で注文ごとの会話を表示。閉じると元の注文一覧へ戻る。 */
export const OrderChatPanel = ({
  label,
  comments,
  onClose,
}: {
  label: string;
  comments: readonly BoardComment[];
  onClose: () => void;
}) => {
  const scroller = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const orders = new Map(
    comments.map((comment) => [comment.orderId, comment.orderNo]),
  );
  useLayoutEffect(() => {
    if (comments.length === 0) return;
    const element = scroller.current;
    if (element && followBottom.current)
      element.scrollTop = element.scrollHeight;
  }, [comments]);
  return (
    <section
      data-comment-dock
      aria-label={`${label} のコメントチャット`}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-slate-50"
    >
      <header className="flex shrink-0 items-center gap-2 border-slate-200 border-b bg-white px-3 py-2">
        <MessageSquareText
          aria-hidden="true"
          className="h-5 w-5 shrink-0 text-slate-600"
        />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-black text-[17px] text-slate-950">
            {label}
          </h2>
          <p className="text-[11px] text-slate-500">コメント</p>
        </div>
        <button
          type="button"
          aria-label="コメントを閉じて注文一覧へ戻る"
          title="注文一覧へ戻る"
          onClick={onClose}
          className="flex h-10 shrink-0 touch-manipulation items-center justify-center gap-1 rounded-md px-2 text-slate-600 hover:bg-slate-100"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          <span className="font-bold text-xs">注文一覧へ</span>
        </button>
      </header>
      <div
        ref={scroller}
        onScroll={() => {
          const element = scroller.current;
          if (element)
            followBottom.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              64;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3"
      >
        <OrderChatMessages comments={comments} />
      </div>
      <footer className="max-h-[45%] shrink-0 overflow-y-auto border-slate-200 border-t bg-white p-2">
        <ul className="grid gap-2">
          {[...orders].map(([orderId, orderNo]) => (
            <StampBar
              key={orderId}
              orderId={orderId}
              label={orders.size > 1 ? `#${orderNoLabel(orderNo)}` : undefined}
            />
          ))}
        </ul>
      </footer>
    </section>
  );
};

/** 閲覧と新規コメント入力で同じ履歴・リアクション表示を使う。 */
export function OrderChatMessages({
  comments,
  highlightedKey,
}: { comments: readonly BoardComment[]; highlightedKey?: string }) {
  const orders = new Set(comments.map((comment) => comment.orderId));
  return (
    <ol
      role="log"
      aria-label="コメント履歴"
      aria-live="polite"
      aria-relevant="additions"
      className="flex flex-col gap-3"
    >
      {comments.map((comment) => {
        const own = comment.author === "master";
        const reaction = commentReaction(comment);
        return (
          <li
            key={commentKey(comment)}
            data-comment-key={commentKey(comment)}
            className={`flex scroll-my-2 flex-col gap-1 rounded-lg ${own ? "items-end" : "items-start"} ${highlightedKey === commentKey(comment) ? "outline-(color:--caos-comment) outline-2 outline-offset-4" : ""}`}
          >
            <span className="px-1 text-[11px] text-slate-500">
              {AUTHORS[comment.author]}
              {orders.size > 1 && ` · #${orderNoLabel(comment.orderNo)}`}
            </span>
            <div
              className={`max-w-[88%] rounded-2xl border px-3 py-2 text-[14px] leading-relaxed ${own ? "border-(color:--caos-comment) bg-(color:--caos-comment-soft) rounded-tr-sm text-slate-950" : "rounded-tl-sm border-slate-200 bg-white text-slate-900"}`}
            >
              {reaction ? (
                <ReactionIcon stamp={reaction} />
              ) : (
                <p className="whitespace-pre-wrap break-words">
                  {comment.text}
                </p>
              )}
            </div>
            <time
              dateTime={comment.createdAt.toISOString()}
              className="px-1 text-[10px] text-slate-500"
            >
              {jstClock(comment.createdAt.getTime()).slice(0, 5)}
            </time>
          </li>
        );
      })}
    </ol>
  );
}
