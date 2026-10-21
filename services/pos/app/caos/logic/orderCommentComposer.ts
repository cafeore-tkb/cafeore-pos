import type { OrderComment } from "@cafeore/common";
import { type BoardComment, commentKey } from "./comments";

export const COMMENT_DRAFT_TTL_MS = 3 * 60 * 1000;

export interface CommentComposerState {
  day: string;
  digits: string;
  targetId: string | null;
  choosing: boolean;
  drafts: Record<string, { text: string; editedAt: number }>;
  confirmed: Record<string, readonly OrderComment[]>;
}

export const emptyCommentComposer = (day: string): CommentComposerState => ({
  day,
  digits: "",
  targetId: null,
  choosing: true,
  drafts: {},
  confirmed: {},
});

// 途中で別の番号に化けないよう、桁あふれは末尾を切る（先頭を押し出さない）。
export const commentOrderDigits = (value: string) =>
  value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9);

export type CommentComposerAction =
  | { type: "reset"; day: string }
  | { type: "digits"; value: string }
  | { type: "choose"; id: string; orderNo: number }
  | { type: "change" }
  | { type: "draft"; id: string; text: string; editedAt: number }
  | { type: "expire"; now: number }
  | { type: "confirmed"; id: string; comment: OrderComment }
  | { type: "sentDraft"; id: string; text: string };

export function commentComposerReducer(
  state: CommentComposerState,
  action: CommentComposerAction,
): CommentComposerState {
  switch (action.type) {
    case "reset":
      return emptyCommentComposer(action.day);
    case "digits":
      return { ...state, digits: commentOrderDigits(action.value) };
    case "choose":
      return {
        ...state,
        targetId: action.id,
        digits: String(action.orderNo),
        choosing: false,
      };
    case "change":
      return { ...state, choosing: true };
    case "draft":
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [action.id]: { text: action.text, editedAt: action.editedAt },
        },
      };
    case "expire": {
      const entries = Object.entries(state.drafts).filter(
        ([, draft]) =>
          draft.text && action.now - draft.editedAt < COMMENT_DRAFT_TTL_MS,
      );
      return entries.length === Object.keys(state.drafts).length
        ? state
        : { ...state, drafts: Object.fromEntries(entries) };
    }
    case "confirmed":
      return {
        ...state,
        confirmed: {
          ...state.confirmed,
          [action.id]: [...(state.confirmed[action.id] ?? []), action.comment],
        },
      };
    case "sentDraft":
      // 送信中に別の注文を選んだり、新しい下書きを書いた場合も、その内容を消さない。
      return state.drafts[action.id]?.text.trim() === action.text
        ? {
            ...state,
            drafts: { ...state.drafts, [action.id]: { text: "", editedAt: 0 } },
          }
        : state;
  }
}

/** APIで成功した本文をすぐ表示し、後から同じWS通知が来ても二重に出さない。 */
export function commentComposerHistory(
  order: { id: string; orderId: number; comments: readonly OrderComment[] },
  confirmed: readonly OrderComment[],
): BoardComment[] {
  const comments = new Map<string, BoardComment>();
  for (const comment of [...order.comments, ...confirmed]) {
    const entry = { ...comment, orderId: order.id, orderNo: order.orderId };
    comments.set(commentKey(entry), entry);
  }
  return [...comments.values()].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
}
