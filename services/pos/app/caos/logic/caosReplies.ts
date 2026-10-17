import type { OrderComment } from "@cafeore/common";

// コメントAPIにIDが無いため、サーバー応答の注文ID・時刻・書き手・本文で識別する。
const STORAGE_KEY = "caos-sent-comments";
const MAX_KEYS = 2000;
const sent = new Set<string>();
const pending = new Map<symbol, { orderId: string; text: string }>();
const listeners = new Set<() => void>();
let revision = 0;
let loaded = false;
const identity = (orderId: string, comment: OrderComment) =>
  JSON.stringify([
    orderId,
    comment.createdAt.getTime(),
    comment.author,
    comment.text,
  ]);
const load = () => {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const keys: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (Array.isArray(keys))
      for (const key of keys.slice(-MAX_KEYS))
        if (typeof key === "string") sent.add(key);
  } catch {
    /* 保存不可でも現在のセッションの記録は使う */
  }
};
const changed = () => {
  revision++;
  for (const listener of listeners) listener();
};
export const subscribeCaosReplies = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const caosRepliesRevision = () => revision;
export const beginCaosReply = (orderId: string, text: string) => {
  load();
  const token = Symbol();
  pending.set(token, { orderId, text });
  changed();
  return token;
};
export const endCaosReply = (token: symbol, comment?: OrderComment) => {
  const request = pending.get(token);
  if (request && comment) {
    sent.add(identity(request.orderId, comment));
    const keys = [...sent].slice(-MAX_KEYS);
    sent.clear();
    for (const key of keys) sent.add(key);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
    } catch {
      /* 保存不可でも通知は抑制する */
    }
  }
  pending.delete(token);
  changed();
};
export const isPendingCaosReply = (
  comment: OrderComment & { orderId: string },
) =>
  comment.author === "master" &&
  [...pending.values()].some(
    (request) =>
      request.orderId === comment.orderId && request.text === comment.text,
  );
export const isSentCaosReply = (
  comment: OrderComment & { orderId: string },
) => {
  load();
  return sent.has(identity(comment.orderId, comment));
};
