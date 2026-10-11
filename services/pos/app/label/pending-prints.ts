import type { PrintJob } from "./document";

/**
 * 刷れなかったシール。刷れるまでこの端末に残し、送り直す（print-util の usePrinter）
 *
 * localStorage に置くので、タブを閉じても開き直せば残っている。同じ端末のタブどうしで共有する。
 * localStorage が使えないとき（プライベートブラウズ・容量切れなど）は、このタブのメモリだけで持つ。
 */
export type PendingPrint = { id: string; job: PrintJob };

const STORAGE_KEY = "cafeore:pending-label-prints";

// localStorage が使えないと分かったら、以後はこちらだけを使う
let memory: PendingPrint[] | null = null;
const listeners = new Set<() => void>();

export const readPendingPrints = (): PendingPrint[] => {
  if (memory) return memory;
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    memory = [];
    return memory;
  }
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writePendingPrints = (prints: PendingPrint[]) => {
  if (!memory) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prints));
      for (const listener of listeners) listener();
      return;
    } catch {
      // 書けなかった：前に書いたものを開き直したときに刷り直さないよう消してから、メモリに移る
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
    }
  }
  memory = prints;
  for (const listener of listeners) listener();
};

export const addPendingPrint = (job: PrintJob) =>
  writePendingPrints([
    ...readPendingPrints(),
    { id: crypto.randomUUID(), job },
  ]);

export const removePendingPrint = (id: string) =>
  writePendingPrints(readPendingPrints().filter((print) => print.id !== id));

/** 残りが変わったら呼ぶ（ほかのタブで変わったときも） */
export const subscribePendingPrints = (listener: () => void) => {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener();
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
  navigator.locks ? navigator.locks.request(STORAGE_KEY, run) : run();
