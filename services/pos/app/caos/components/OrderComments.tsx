import { AUTHOR_MARKS, type CaosCard } from "@cafeore/common";
import { ChevronRight, MessageSquareText, X } from "lucide-react";
import type React from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type CommentAnchor,
  useCommentPopupPosition,
} from "../hooks/useCommentPopupPosition";
import { type CardLooks, orderNoLabel } from "../logic/cards";
import {
  type BoardComment,
  STAMPS,
  commentKey,
  commentReaction,
} from "../logic/comments";
import { caosLog } from "../utils/log";
import { FloatingWindowScope, useFloatingWindow } from "./FloatingWindows";
import { ReactionIcon } from "./ReactionIcon";
import { VoiceComment } from "./VoiceComment";

/** 新着通知と同じ寿命でタイムラインのバッジを表示する。初回の既存コメントは含めない。 */
export const FreshCommentsContext = createContext<readonly BoardComment[]>([]);

/** 未割当では注文見出しに1つだけ表示。複数カードで同じコメントを重複集計しない。 */
export const OrderCommentBadge = ({
  cards,
  looks,
  orderNo,
}: { cards: readonly CaosCard[]; looks: CardLooks; orderNo?: number }) => {
  const comments = new Map(
    cards
      .flatMap((card) => looks.get(card.key)?.comments ?? [])
      .filter((comment) => orderNo === undefined || comment.orderNo === orderNo)
      .map((comment) => [commentKey(comment), comment]),
  );
  if (!comments.size) return null;
  const nos = [
    ...new Set([...comments.values()].map((comment) => comment.orderNo)),
  ];
  return (
    <CommentMark
      count={comments.size}
      label={nos.map((no) => `#${orderNoLabel(no)}`).join("+")}
      className="h-6 w-6 shrink-0"
    />
  );
};

// 注文のコメント（レジなどで付けたもの）。カードの印と、開いたときの中身（スタンプで返す）と、右下の置き場（選んだ注文のコメント・新しいコメントの知らせ）

/** コメントにスタンプで返す（hooks/useStampReply）。操作の画面（本番の盤面）にだけ渡す。無ければスタンプを出さない */
export const StampReplyContext = createContext<{
  /** 送っているあいだ（押せない） */
  sending: boolean;
  send: (orderId: string, stamp: string) => Promise<boolean>;
} | null>(null);

/** 注文（orderId）にスタンプを返すボタンの並び（キーボードを出さずに返す）。label は何の注文に返すか（いくつかの注文のコメントを並べたとき） */
export const StampBar: React.FC<{
  orderId: string;
  label?: string;
  disabled?: boolean;
  voiceDisabled?: boolean;
  voiceEditor?: React.ComponentProps<typeof VoiceComment>["inline"];
  /** パネルで送信の成功を表示するための共通コールバック。 */
  onSend?: (text: string) => Promise<boolean>;
}> = ({
  orderId,
  label,
  disabled = false,
  voiceDisabled = disabled,
  voiceEditor,
  onSend,
}) => {
  const reply = useContext(StampReplyContext);
  if (!reply) return null;
  return (
    <li className="flex flex-wrap items-center gap-1">
      {label && (
        <span className="font-black font-mono text-[12px] text-slate-600">
          {label}
        </span>
      )}
      {STAMPS.map((stamp) => {
        return (
          <button
            key={stamp}
            type="button"
            title={
              stamp === "来て！"
                ? "直接来て状況を確認してください、と返す"
                : `「${stamp}」と返す`
            }
            aria-label={`「${stamp}」と返す`}
            disabled={reply.sending || disabled}
            onClick={(event) => {
              // 行・カードを押したときの選ぶ・開くに渡さない
              event.stopPropagation();
              if (onSend) void onSend(stamp);
              else void reply.send(orderId, stamp);
            }}
            className="border-(color:--caos-comment) active:bg-(color:--caos-comment-soft) flex h-12 min-w-10 flex-1 touch-manipulation items-center justify-center rounded-lg border bg-white px-1 leading-none disabled:opacity-40"
          >
            <ReactionIcon stamp={stamp} />
          </button>
        );
      })}
      <VoiceComment
        orderId={orderId}
        sending={reply.sending || voiceDisabled}
        send={reply.send}
        inline={voiceEditor}
      />
    </li>
  );
};

/** コメントの印を押したときに、その注文（orderLabel）のコメントを押した位置の近くの CommentDock に出す。操作の画面の盤面（App の ControlWorkspace）にだけ渡す（右のパネルは中身を出しているので渡さない）。無ければ印は押せない */
export const OpenCommentsContext = createContext<
  ((label: string, anchor?: HTMLElement) => void) | null
>(null);

/**
 * コメントのある注文のカードの印。カード（OrderCard）の注文番号の右側に並べる（className で置き場所と大きさを替える）。
 * 押すと（OpenCommentsContext があれば）label の注文のコメントを押した位置の近くに出す（カードを押したとき（掴む・開く）とは別。選択を外してもコメントを読めるように）
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
      title={`${title}（押した場所の近くに表示）`}
      // カードを押したとき（開く）に渡さない（掴むのは、useCardDrag がボタンの上の押下を見ないので渡らない）
      onClick={(event) => {
        event.stopPropagation();
        caosLog("comment.mark.clicked", { label, count });
        open(label, event.currentTarget);
      }}
      className={`touch-manipulation ${look}`}
    >
      {icon}
    </button>
  );
};

/**
 * コメントの中身（付けた順。書き手は POS と同じ 1 文字）。いくつかの注文のコメントなら注文番号も出す。
 * 下にスタンプで返すボタン（StampReplyContext があるとき。注文ごとに）
 */
export const CommentList: React.FC<{
  comments?: readonly BoardComment[];
  className?: string;
}> = ({ comments = [], className = "" }) => {
  if (comments.length === 0) return null;
  const orders = new Map(comments.map((c) => [c.orderId, c.orderNo]));
  const withNo = orders.size > 1;
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
          <span className="min-w-0 break-words">
            {commentReaction(comment) ? (
              <ReactionIcon stamp={commentReaction(comment) ?? ""} />
            ) : (
              comment.text
            )}
          </span>
        </li>
      ))}
      {[...orders].map(([orderId, orderNo]) => (
        <StampBar
          key={orderId}
          orderId={orderId}
          label={withNo ? `#${orderNoLabel(orderNo)}` : undefined}
        />
      ))}
    </ul>
  );
};

// 知らせは新しいものからこれだけ出す（ほかは「ほかに新しいコメント N 件」）
const NOTICES_SHOWN = 3;

/**
 * 画面の右下に重ねるコメントの置き場（上はヘッダーの操作と右上の確かめがあるので避ける。右のパネルが開いていればその左。caos.css の .caos-comment-dock）。
 * 上に見ている注文（選んだ注文か、印を押した注文）のコメント（×で閉じる）、下に新しいコメントの知らせ（新しいものが下）。
 * 知らせは押すとその注文を開き（onOpen）、×で閉じる。どちらも押すまで残す
 */
type ViewingComment = {
  label: string;
  comments: readonly BoardComment[];
  anchor?: CommentAnchor;
};

export const CommentDock: React.FC<{
  /** 見ている注文（orderLabel）と、そのコメント（コメントがあるときだけ） */
  viewing?: {
    label: string;
    comments: readonly BoardComment[];
    anchor?: CommentAnchor;
  };
  onCloseViewing: () => void;
  onRestoreViewing?: (label: string) => void;
  notices: readonly BoardComment[];
  onOpen: (comment: BoardComment) => void;
  onDismiss: (comments: readonly BoardComment[]) => void;
}> = ({
  viewing,
  onCloseViewing,
  onRestoreViewing,
  notices,
  onOpen,
  onDismiss,
}) => {
  const saved = useRef(new Map<string, ViewingComment>());
  const [, refresh] = useState(0);
  if (viewing) saved.current.set(viewing.label, viewing);
  const noticesWindow = useFloatingWindow("新着コメント", notices.length > 0);
  const shown = notices.slice(-NOTICES_SHOWN);
  const hidden = notices.length - shown.length;
  if (notices.length === 0 && saved.current.size === 0) return null;
  return (
    // 中を押しても、開いているもの（未割当のカード・右のパネル）を閉じない（useOutsidePress）
    <div
      data-comment-dock
      aria-live="polite"
      className="caos-comment-dock pointer-events-none fixed bottom-2 z-[150] flex w-[340px] flex-col gap-1.5"
    >
      {[...saved.current.values()].map((item) => (
        <FloatingWindowScope
          key={item.label}
          value={{
            active: viewing?.label === item.label,
            activate: () => onRestoreViewing?.(item.label),
            suspend: () => {
              if (viewing?.label === item.label) onCloseViewing();
            },
          }}
        >
          <ViewingCommentWindow
            viewing={item}
            onDone={() => {
              saved.current.delete(item.label);
              refresh((value) => value + 1);
              if (viewing?.label === item.label) onCloseViewing();
            }}
          />
        </FloatingWindowScope>
      ))}

      <section
        ref={(element) => {
          noticesWindow.ref.current = element;
        }}
        style={noticesWindow.style}
        data-popup-hidden={noticesWindow.hidden}
      >
        {notices.length > 0 && (
          <header className="pointer-events-auto flex items-center rounded-t-lg bg-white px-2 font-bold text-sm">
            {noticesWindow.handle}
            <span className="flex-1">新着コメント</span>
            <button
              type="button"
              onClick={() => onDismiss(notices)}
              className="min-h-10 rounded border px-2 text-xs"
            >
              確認済み
            </button>
            <button
              type="button"
              onClick={noticesWindow.hide}
              aria-label="新着コメントを非表示"
              className="h-10 w-10"
            >
              ×
            </button>
          </header>
        )}
        {hidden > 0 && (
          <div className="border-(color:--caos-comment) bg-(color:--caos-comment-soft) pointer-events-auto flex items-center justify-between rounded-lg border-2 px-2 py-1 font-black text-[12px] text-slate-700 shadow-lg">
            ほかに新しいコメント {hidden} 件
            <button
              type="button"
              onClick={noticesWindow.hide}
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
              onClick={() => {
                caosLog("comment.notice.clicked", {
                  orderId: comment.orderId,
                  orderNo: comment.orderNo,
                  key: commentKey(comment),
                });
                onOpen(comment);
              }}
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
              onClick={noticesWindow.hide}
              aria-label="閉じる"
              className="border-(color:--caos-comment) flex w-10 shrink-0 touch-manipulation items-center justify-center border-l text-slate-500"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}{" "}
      </section>
    </div>
  );
};

const ViewingCommentWindow = ({
  viewing,
}: { viewing: ViewingComment; onDone: () => void }) => {
  const popup = useCommentPopupPosition(viewing.anchor);
  const floating = useFloatingWindow(`${viewing.label} のコメント`, true);
  const popupRef = popup.ref;
  const floatingRef = floating.ref;
  const attachPopup = useCallback(
    (element: HTMLElement | null) => {
      popupRef(element);
      floatingRef.current = element;
    },
    [popupRef, floatingRef],
  );
  useEffect(() => {
    if (!viewing || !popup.element || floating.hidden) return;
    const element = popup.element;
    let voiceProtectedAtPress = false;
    let voiceBusyAtPress = false;
    const rememberVoiceInput = () => {
      voiceBusyAtPress = Boolean(
        element.querySelector('[data-voice-busy="true"]'),
      );
      voiceProtectedAtPress = Boolean(
        element.querySelector("[data-voice-panel] textarea:focus"),
      );
    };
    const closeOutside = (event: MouseEvent) => {
      if (
        event.target instanceof Element &&
        event.target.closest("[data-popup-tray], [data-caos-layer]")
      )
        return;
      if (event.target instanceof Node && element.contains(event.target))
        return;
      // 親のポップアップ側も録音中・送信中の枠外操作を飲み込まない。
      if (voiceBusyAtPress || element.querySelector('[data-voice-busy="true"]'))
        return;
      const protectedVoice =
        voiceProtectedAtPress ||
        Boolean(element.querySelector("[data-voice-panel] textarea:focus"));
      if (protectedVoice) {
        const focused = element.querySelector<HTMLTextAreaElement>(
          "[data-voice-panel] textarea:focus",
        );
        focused?.blur();
      } else floating.hide();
      // 最初の枠外タップは閉じるだけにし、背後の割当・進行操作へ渡さない。
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("pointerdown", rememberVoiceInput, true);
    document.addEventListener("click", closeOutside, true);
    return () => {
      document.removeEventListener("pointerdown", rememberVoiceInput, true);
      document.removeEventListener("click", closeOutside, true);
    };
  }, [viewing, popup.element, floating.hidden, floating.hide]);
  return (
    <section
      ref={attachPopup}
      data-popup-hidden={floating.hidden}
      style={{ ...popup.style, ...floating.style }}
      aria-label={`${viewing.label} のコメント`}
      className="border-(color:--caos-comment) pointer-events-auto rounded-lg border-2 bg-white p-1.5 shadow-lg"
    >
      <header className="mb-1 flex items-center gap-1 pl-1">
        {floating.handle}
        <MessageSquareText className="text-(color:--caos-comment) h-3.5 w-3.5" />
        <h3 className="text-(color:--caos-comment) min-w-0 flex-1 truncate font-black text-[12px]">
          {viewing.label} のコメント
        </h3>
        <button
          type="button"
          onClick={floating.hide}
          aria-label="コメントを閉じる"
          className="flex h-7 w-8 shrink-0 touch-manipulation items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
        >
          <X className="h-4 w-4" />
        </button>
      </header>
      <FloatingWindowScope
        value={{ active: !floating.hidden, activate: floating.restore }}
      >
        <CommentList
          comments={viewing.comments}
          className="max-h-[40vh] overflow-y-auto"
        />
      </FloatingWindowScope>
    </section>
  );
};
