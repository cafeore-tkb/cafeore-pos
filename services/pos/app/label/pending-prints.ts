import type { PrintJob } from "./document";

/**
 * 刷れなかったシール。刷れるまでこの端末に残し、送り直す（print-util の usePrinter）
 *
 * 1 件ずつ localStorage の別のキーに置く（読んで書き戻さないので、同じ端末のタブどうしで足し消しが重なっても消えない）。
 * タブを閉じても開き直せば残っていて、同じ端末のタブどうしで共有する。
 * localStorage に書けないとき（使えない・容量切れなど）は、そのタブのメモリだけで持つ。
 */
export type PendingPrint = { id: string; at: number; job: PrintJob };

const PREFIX = "cafeore:pending-label-print:";

// localStorage に書けなかったもの
const memory = new Map<string, PendingPrint>();
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

// 置いたものの形か（壊れたもの・ほかが書いたものは送らない）
const parse = (id: string, raw: string | null): PendingPrint | null => {
  try {
    const value: unknown = JSON.parse(raw ?? "");
    if (
      typeof value === "object" &&
      value !== null &&
      "at" in value &&
      typeof value.at === "number" &&
      "job" in value &&
      typeof value.job === "object" &&
      value.job !== null &&
      "labels" in value.job &&
      Array.isArray(value.job.labels)
    ) {
      return { id, at: value.at, job: value.job as PrintJob };
    }
  } catch {}
  return null;
};

const stored = () => {
  const prints: PendingPrint[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(PREFIX)) continue;
      const print = parse(key.slice(PREFIX.length), localStorage.getItem(key));
      if (print) prints.push(print);
    }
  } catch {
    // 読めなければメモリの分だけ
  }
  return prints;
};

/** 残っているシール（古い順） */
export const readPendingPrints = () =>
  [...stored(), ...memory.values()].sort((a, b) => a.at - b.at);

/** id は後で消すときの目印（緊急のシールは入れ直しの id。取り消したら消す）。無ければ新しく作る */
export const addPendingPrint = (
  job: PrintJob,
  id: string = crypto.randomUUID(),
) => {
  const print = { id, at: Date.now(), job };
  try {
    localStorage.setItem(
      PREFIX + print.id,
      JSON.stringify({ at: print.at, job }),
    );
  } catch {
    memory.set(print.id, print);
  }
  notify();
};

export const removePendingPrint = (id: string) => {
  memory.delete(id);
  try {
    localStorage.removeItem(PREFIX + id);
  } catch {}
  notify();
};

/** 残りが変わったら呼ぶ（ほかのタブで変わったときも） */
export const subscribePendingPrints = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  };
  listeners.add(listener);
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
};

/**
 * 残りを送り直すあいだ、同じ端末のほかのタブには送り直させない（同じシールを 2 回刷らないように）。
 * Web Locks が無いブラウザでは、そのまま走らせる
 */
export const withPendingPrintsLock = (run: () => Promise<void>) =>
  navigator.locks ? navigator.locks.request(PREFIX, run) : run();
