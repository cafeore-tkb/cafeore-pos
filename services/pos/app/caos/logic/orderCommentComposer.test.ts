import type { OrderComment } from "@cafeore/common";
import { describe, expect, test } from "vitest";
import {
  COMMENT_DRAFT_TTL_MS,
  commentComposerHistory,
  commentOrderDigits,
  emptyCommentComposer,
  commentComposerReducer as reduce,
} from "./orderCommentComposer";
const day = "2026-10-21";
const comment = (
  text: string,
  time = "2026-10-21T03:00:00Z",
): OrderComment => ({ text, author: "master", createdAt: new Date(time) });
describe("[unit] order comment composer", () => {
  test("binds drafts to order IDs across target changes and delayed send success", () => {
    let state = reduce(emptyCommentComposer(day), {
      type: "choose",
      id: "a",
      orderNo: 1001,
    });
    state = reduce(state, {
      type: "draft",
      id: "a",
      text: "Aの下書き",
      editedAt: 0,
    });
    state = reduce(state, { type: "change" });
    state = reduce(state, { type: "digits", value: "1002" });
    expect(state.targetId).toBe("a");
    state = reduce(state, { type: "choose", id: "b", orderNo: 1002 });
    state = reduce(state, {
      type: "draft",
      id: "b",
      text: "Bの下書き",
      editedAt: 1,
    });
    state = reduce(state, { type: "sentDraft", id: "a", text: "Aの下書き" });
    expect(state.targetId).toBe("b");
    expect(state.drafts.b.text).toBe("Bの下書き");
    expect(state.drafts.a.text).toBe("");
  });
  test("an old send completion does not erase a subsequently edited draft", () => {
    const state = reduce(emptyCommentComposer(day), {
      type: "draft",
      id: "a",
      text: "新しい本文",
      editedAt: 0,
    });
    expect(
      reduce(state, { type: "sentDraft", id: "a", text: "古い本文" }),
    ).toBe(state);
  });
  test("expires each draft three minutes after its last edit", () => {
    let state = reduce(emptyCommentComposer(day), {
      type: "draft",
      id: "a",
      text: "A",
      editedAt: 0,
    });
    state = reduce(state, {
      type: "draft",
      id: "b",
      text: "B",
      editedAt: 1000,
    });
    expect(
      reduce(state, { type: "expire", now: COMMENT_DRAFT_TTL_MS - 1 }),
    ).toBe(state);
    state = reduce(state, { type: "expire", now: COMMENT_DRAFT_TTL_MS });
    expect(state.drafts.a).toBeUndefined();
    expect(state.drafts.b.text).toBe("B");
    state = reduce(state, {
      type: "draft",
      id: "b",
      text: "編集中",
      editedAt: COMMENT_DRAFT_TTL_MS,
    });
    expect(
      reduce(state, { type: "expire", now: COMMENT_DRAFT_TTL_MS + 1000 }).drafts
        .b.text,
    ).toBe("編集中");
    expect(
      reduce(state, { type: "expire", now: COMMENT_DRAFT_TTL_MS * 2 }).drafts,
    ).toEqual({});
  });
  test("resets target, drafts and confirmed comments on date or practice change", () => {
    let state = reduce(emptyCommentComposer(day), {
      type: "choose",
      id: "a",
      orderNo: 1001,
    });
    state = reduce(state, {
      type: "draft",
      id: "a",
      text: "昨日の下書き",
      editedAt: 0,
    });
    state = reduce(state, {
      type: "confirmed",
      id: "a",
      comment: comment("送信済み"),
    });
    expect(reduce(state, { type: "reset", day: "2026-10-22" })).toEqual(
      emptyCommentComposer("2026-10-22"),
    );
  });
  test("accepts four-digit numbers without shifting overflow to a different number", () => {
    expect(commentOrderDigits("#01001")).toBe("1001");
    expect(commentOrderDigits("000")).toBe("");
    expect(commentOrderDigits("1234567890")).toBe("123456789");
  });
  test("displays confirmed API results immediately and deduplicates subsequent WS echo", () => {
    const sent = comment("新しいコメント");
    const order = {
      id: "a",
      orderId: 1001,
      comments: [comment("前のコメント", "2026-10-21T02:00:00Z")],
    };
    const beforeWS = commentComposerHistory(order, [sent]);
    const afterWS = commentComposerHistory(
      { ...order, comments: [...order.comments, sent] },
      [sent],
    );
    expect(beforeWS.map((c) => c.text)).toEqual([
      "前のコメント",
      "新しいコメント",
    ]);
    expect(afterWS).toEqual(beforeWS);
    expect(afterWS.every((c) => c.orderId === "a" && c.orderNo === 1001)).toBe(
      true,
    );
  });
  test("preserves identical text sent at distinct times", () => {
    expect(
      commentComposerHistory(
        { id: "a", orderId: 1001, comments: [comment("OK")] },
        [comment("OK", "2026-10-21T03:01:00Z")],
      ),
    ).toHaveLength(2);
  });
});
