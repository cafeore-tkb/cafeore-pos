import { type OrderEntity, type WithId, jstClock } from "@cafeore/common";
import { ChevronRight, Delete, MessageSquareText, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { useOrderCommentComposer } from "../hooks/useOrderCommentComposer";
import { orderNoLabel } from "../logic/cards";
import { type BoardComment, commentKey } from "../logic/comments";
import { OrderChatMessages } from "./OrderChatPanel";
import { StampBar } from "./OrderComments";
import { SidePanel } from "./SidePanels";

type Composer = ReturnType<typeof useOrderCommentComposer>;

const summary = (order: WithId<OrderEntity>) => {
  const counts = new Map<string, number>();
  for (const cup of order.getCups())
    counts.set(cup.abbr, (counts.get(cup.abbr) ?? 0) + 1);
  return (
    [...counts].map(([name, count]) => `${name} ×${count}`).join("・") ||
    "カップなし"
  );
};
const statusLabel = (order: WithId<OrderEntity>) =>
  order.servedAt ? "提供済み" : order.readyAt ? "準備完了" : "準備中";

/** 本日の注文をIDで固定して送信する。盤面の選択・カード統合では宛先を変えない。 */
export function OrderCommentPanel({
  composer,
  loaded,
  connected,
  sending,
  send,
  notices,
  onClose,
}: {
  composer: Composer;
  loaded: boolean;
  connected: boolean;
  sending: boolean;
  send: (orderId: string, text: string) => Promise<boolean>;
  notices: readonly BoardComment[];
  onClose: () => void;
}) {
  const { state, today, target, draft, history } = composer;
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [lookup, setLookup] = useState(false);
  const [sendMessage, setSendMessage] = useState<{
    orderId: string;
    ok: boolean;
  } | null>(null);
  const [bottomInset, setBottomInset] = useState(0);
  const [focusedComment, setFocusedComment] = useState<string | null>(null);
  const scrolledComment = useRef<string | null>(null);
  const submitting = useRef(false);
  const historyRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  // iPadのソフトウェアキーボードで送信欄が隠れないよう、表示可能な高さへ収める。
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () =>
      setBottomInset(
        viewport
          ? Math.max(
              0,
              window.innerHeight - viewport.height - viewport.offsetTop,
            )
          : 0,
      );
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, []);
  const followedTarget = useRef<string>();
  useEffect(() => {
    if (followedTarget.current !== target?.id) {
      followBottom.current = true;
      followedTarget.current = target?.id;
    }
    if (history.length && followBottom.current) {
      const element = historyRef.current;
      if (element) element.scrollTop = element.scrollHeight;
    }
  }, [history, target?.id]);
  useEffect(() => {
    if (!focusedComment || scrolledComment.current === focusedComment) return;
    const element = [
      ...(historyRef.current?.querySelectorAll<HTMLElement>(
        "[data-comment-key]",
      ) ?? []),
    ].find((entry) => entry.dataset.commentKey === focusedComment);
    if (element && history.length) {
      element.scrollIntoView({ block: "nearest" });
      scrolledComment.current = focusedComment;
    }
  }, [focusedComment, history]);

  const choosing = state.choosing || !target;
  const blocked = !loaded || !connected || !target;
  const locked = sending || voiceBusy;
  const choose = (order: WithId<OrderEntity>) => {
    if (locked) return;
    composer.choose(order);
    setSendMessage(null);
    setFocusedComment(null);
    setLookup(false);
  };
  const find = () => {
    if (locked || !state.digits) return;
    const order = today.find((order) => order.orderId === Number(state.digits));
    if (order) choose(order);
    else setLookup(true);
  };
  const sendText = async (text: string, clearDraft = false) => {
    const content = text.trim();
    if (blocked || locked || submitting.current || !content || !target)
      return false;
    // 宛先はawaitの前に固定。成功時に、後から書いた別の下書きを消さない。
    const { id } = target;
    submitting.current = true;
    setSendMessage(null);
    try {
      if (!(await send(id, content))) {
        setSendMessage({ orderId: id, ok: false });
        return false;
      }
      if (clearDraft) composer.sentDraft(id, content);
      setSendMessage({ orderId: id, ok: true });
      return true;
    } finally {
      submitting.current = false;
    }
  };
  const footer =
    !choosing && target ? (
      <div
        data-order-comment-panel
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing)
            onClose();
          event.stopPropagation();
        }}
        className="max-h-[60%] shrink-0 overflow-y-auto border-slate-300 border-t bg-white p-4"
      >
        {sendMessage?.orderId === target.id && (
          <output
            aria-live="polite"
            className={`mb-3 block rounded px-2 py-1.5 text-xs ${sendMessage.ok ? "bg-(color:--caos-comment-soft) text-(color:--caos-comment)" : "bg-red-50 text-red-700"}`}
          >
            {sendMessage.ok
              ? `#${orderNoLabel(target.orderId)} にコメントを追加しました`
              : "コメントを送れませんでした。下書きは残っています。もう一度送信してください。"}
          </output>
        )}
        <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
          <span className="font-bold text-slate-700">リアクション</span>
          <span className="text-slate-500">4種はタップで送信</span>
        </div>
        <ul className="mb-4">
          <StampBar
            key={target.id}
            orderId={target.id}
            disabled={blocked || voiceBusy}
            voiceDisabled={blocked}
            voiceEditor={{
              text: draft,
              onChange: (text) => composer.setDraft(target.id, text),
              onBusyChange: setVoiceBusy,
            }}
            onSend={(text) => sendText(text)}
          />
        </ul>
        <label
          htmlFor="caos-comment-text"
          className="mb-2 flex items-center justify-between gap-2 font-bold text-[13px]"
        >
          コメントを追加{" "}
          <span className="font-normal text-[11px] text-slate-500">
            送信者：マスター
          </span>
        </label>
        <p className="mb-1.5 text-[11px] text-slate-500">
          下書きは最終編集から約3分で消えます
        </p>
        <textarea
          id="caos-comment-text"
          value={draft}
          onChange={(event) => composer.setDraft(target.id, event.target.value)}
          disabled={locked}
          rows={3}
          placeholder="伝えたい内容を入力"
          className="border-(color:--caos-comment) focus:outline-(color:--caos-comment) block min-h-20 w-full select-text resize-none rounded-lg border-2 bg-white px-3 py-2 text-[16px] text-slate-950 leading-relaxed disabled:bg-slate-100"
        />
        <button
          type="button"
          disabled={blocked || locked || !draft.trim()}
          onClick={() => void sendText(draft, true)}
          className="bg-(color:--caos-comment) mt-3 flex h-12 w-full touch-manipulation items-center justify-center gap-2 rounded-lg font-bold text-white disabled:bg-slate-200 disabled:text-slate-400"
        >
          <Send className="h-4 w-4" />
          {sending ? "送信中…" : `#${orderNoLabel(target.orderId)} に追加`}
        </button>
      </div>
    ) : undefined;

  return (
    <SidePanel
      title="注文にコメント"
      icon={
        <MessageSquareText className="text-(color:--caos-comment) h-5 w-5 shrink-0" />
      }
      onClose={onClose}
      contentClassName="flex flex-col"
      style={{ bottom: bottomInset }}
      footer={footer}
    >
      <div
        data-order-comment-panel
        className="flex min-h-0 flex-1 flex-col"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !event.nativeEvent.isComposing)
            onClose();
          event.stopPropagation();
        }}
      >
        {!connected && (
          <output className="shrink-0 border-amber-200 border-b bg-amber-50 px-4 py-2 text-amber-900 text-xs">
            通信が切れています。下書きは保持し、再接続後に送信できます。
          </output>
        )}
        {notices.length > 0 && (
          <section
            aria-label="新着コメント"
            className="max-h-40 shrink-0 overflow-y-auto border-red-200 border-b bg-red-50 px-4 py-2"
          >
            <h3 className="mb-1 font-bold text-red-800 text-xs">
              新着コメント {notices.length}件
            </h3>
            {[...notices].reverse().map((comment) => (
              <button
                type="button"
                key={commentKey(comment)}
                disabled={locked}
                onClick={() => {
                  const order = today.find(
                    (order) => order.id === comment.orderId,
                  );
                  if (!order) return;
                  choose(order);
                  scrolledComment.current = null;
                  setFocusedComment(commentKey(comment));
                }}
                className="flex min-h-12 w-full touch-manipulation items-center gap-2 border-red-100 border-b py-2 text-left disabled:opacity-40"
              >
                <strong className="shrink-0 font-mono text-[18px]">
                  #{orderNoLabel(comment.orderNo)}
                </strong>
                <span className="line-clamp-2 min-w-0 flex-1 break-words text-[13px]">
                  {comment.text}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-red-700" />
              </button>
            ))}
          </section>
        )}
        {choosing ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <label
              htmlFor="caos-comment-number"
              className="mb-2 block font-bold text-[13px]"
            >
              本日の注文番号
            </label>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                find();
              }}
            >
              <input
                id="caos-comment-number"
                inputMode="numeric"
                autoComplete="off"
                value={state.digits}
                onChange={(event) => {
                  composer.setDigits(event.target.value);
                  setLookup(false);
                }}
                placeholder="# 番号を入力"
                className="h-14 min-w-0 flex-1 select-text rounded-lg border-2 border-slate-400 bg-white px-3 font-bold font-mono text-[28px]"
              />
              <button
                type="submit"
                disabled={!loaded || !state.digits || locked}
                className="bg-(color:--caos-comment) h-14 shrink-0 rounded-lg px-4 font-bold text-white disabled:opacity-40"
              >
                表示
              </button>
            </form>
            <div
              className="mt-4 grid grid-cols-3 gap-2"
              aria-label="注文番号のテンキー"
            >
              {[..."789456123", "clear", "0", "back"].map((key) => (
                <button
                  type="button"
                  key={key}
                  aria-label={
                    key === "clear"
                      ? "番号を消す"
                      : key === "back"
                        ? "1文字消す"
                        : key
                  }
                  onClick={() => {
                    composer.setDigits(
                      key === "clear"
                        ? ""
                        : key === "back"
                          ? state.digits.slice(0, -1)
                          : state.digits + key,
                    );
                    setLookup(false);
                  }}
                  className="flex h-12 touch-manipulation items-center justify-center rounded-lg border border-slate-300 bg-white font-bold font-mono text-[24px] active:bg-slate-100"
                >
                  {key === "clear" ? (
                    "C"
                  ) : key === "back" ? (
                    <Delete className="h-5 w-5" />
                  ) : (
                    key
                  )}
                </button>
              ))}
            </div>
            {!loaded ? (
              <output className="mt-4 text-slate-600 text-sm">
                注文を読み込んでいます…
              </output>
            ) : lookup ? (
              <output className="mt-4 font-bold text-red-700 text-sm">
                本日の #{state.digits}{" "}
                は見つかりません。番号を確認してください。
              </output>
            ) : (
              <p className="mt-4 text-slate-500 text-xs leading-relaxed">
                コメントのない注文や提供済みの注文にも追加できます。
              </p>
            )}
            {state.targetId && !target && (
              <output className="mt-3 text-red-700 text-sm">
                選んだ注文が見つかりません。取消・削除や日付を確認してください。
              </output>
            )}
            <h3 className="mt-6 mb-2 font-bold text-[13px]">
              最近の注文から選ぶ
            </h3>
            {today.length === 0 && loaded && (
              <p className="text-slate-500 text-sm">本日の注文はありません</p>
            )}
            {today.slice(0, 10).map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => choose(order)}
                className="flex min-h-16 w-full touch-manipulation items-center gap-3 border-slate-200 border-b py-3 text-left"
              >
                <strong className="shrink-0 font-mono text-[22px]">
                  #{orderNoLabel(order.orderId)}
                </strong>
                <span className="min-w-0 flex-1 break-words text-[13px] text-slate-600">
                  {summary(order)}
                </span>
                <span className="shrink-0 text-slate-500 text-xs">
                  {statusLabel(order)}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="shrink-0 border-slate-200 border-b p-4">
              <div className="flex items-center gap-2">
                <strong className="font-bold font-mono text-[30px]">
                  #{orderNoLabel(target.orderId)}
                </strong>
                <span className="rounded bg-slate-100 px-2 py-1 font-bold text-slate-700 text-xs">
                  {statusLabel(target)}
                </span>
                <button
                  type="button"
                  disabled={locked}
                  onClick={composer.change}
                  className="ml-auto h-10 shrink-0 rounded-md border border-slate-300 px-3 font-bold text-xs disabled:opacity-40"
                >
                  番号を変更
                </button>
              </div>
              <p className="mt-1.5 break-words text-[13px] text-slate-600">
                {summary(target)} ・ 注文{" "}
                {jstClock(target.createdAt.getTime()).slice(0, 5)}
              </p>
            </div>
            <div
              ref={historyRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50 p-4"
              onScroll={() => {
                const e = historyRef.current;
                if (e)
                  followBottom.current =
                    e.scrollHeight - e.scrollTop - e.clientHeight < 64;
              }}
            >
              <h3 className="mb-4 font-bold text-slate-500 text-xs">
                コメント履歴
              </h3>
              {history.length ? (
                <OrderChatMessages
                  comments={history}
                  highlightedKey={focusedComment ?? undefined}
                />
              ) : (
                <p className="text-slate-500 text-sm">
                  まだコメントはありません
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </SidePanel>
  );
}
