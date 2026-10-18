import { createDeviceStore } from "~/lib/device-store";
import { type PrintJob, toPrintJob } from "./document";

/**
 * 刷れなかったシール。刷れるまでこの端末に残し、送り直す（print-util の usePrinter）。
 * 置き方は ~/lib/device-store（1 件ずつ localStorage に置き、タブを閉じても残り、同じ端末のタブどうしで共有する）
 */
export type PendingPrint = { id: string; at: number; job: PrintJob };

// 置いたものの形か（壊れたもの・ほかが書いたものは送らない）
const parse = (id: string, value: unknown): PendingPrint | null => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("at" in value) ||
    typeof value.at !== "number" ||
    !("job" in value)
  )
    return null;
  const job = toPrintJob(value.job);
  return job ? { id, at: value.at, job } : null;
};

const store = createDeviceStore("cafeore:pending-label-print:", parse);

// このタブで取り消しを知った緊急の id。刷っている間に取り消されたら、刷れなくても残さない
const cancelled = new Set<string>();
// 完了の記録は1時間だけ保持する。別タブの遅れて返る印刷失敗も抑止する。
export const COMPLETED_PRINT_TTL_MS = 60 * 60 * 1_000;
const COMPLETED_PREFIX = "cafeore:completed-label-print:";
// localStorage に書けなかったときだけ、このタブのメモリに残す。
const completed = new Map<string, number>();

const pruneCompletedPrints = (now: number) => {
  for (const [id, expiresAt] of completed) {
    if (expiresAt <= now) completed.delete(id);
  }
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key?.startsWith(COMPLETED_PREFIX)) continue;
      const expiresAt = Number(localStorage.getItem(key));
      if (!Number.isFinite(expiresAt) || expiresAt <= now) {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // ストレージが使えなくても、メモリの期限切れは削除する。
  }
};

const isPrintCompleted = (id: string) => {
  const now = Date.now();
  let expiresAt = completed.get(id) ?? 0;
  try {
    expiresAt = Math.max(
      expiresAt,
      Number(localStorage.getItem(COMPLETED_PREFIX + id)) || 0,
    );
  } catch {}
  if (expiresAt > now) return true;
  completed.delete(id);
  return false;
};

/** 残っているシール（古い順） */
export const readPendingPrints = store.read;

/** id は後で消すときの目印（緊急のシールは入れ直しの id。取り消したら消す）。無ければ新しく作る */
export const addPendingPrint = (
  job: PrintJob,
  id: string = crypto.randomUUID(),
) => {
  if (isPrintSettled(id)) return;
  store.put({ id, at: Date.now(), job });
};

export const removePendingPrint = store.remove;

/** このタブで取り消しを知った緊急（入れ直し）の id か。そのシールはレジにも頼まない */
export const isPrintCancelled = (id: string) => cancelled.has(id);

/** 直接印刷の結果を待つ間に、代理印刷で完了・取り消しになったシールか。 */
export const isPrintSettled = (id: string) =>
  cancelled.has(id) || isPrintCompleted(id);

/** 代理印刷で刷れたシールを端末から消し、遅れて来た直接印刷の失敗で残し直さない。 */
export const completePendingPrint = (id: string) => {
  const now = Date.now();
  pruneCompletedPrints(now);
  const expiresAt = now + COMPLETED_PRINT_TTL_MS;
  try {
    localStorage.setItem(COMPLETED_PREFIX + id, String(expiresAt));
    completed.delete(id);
  } catch {
    completed.set(id, expiresAt);
  }
  removePendingPrint(id);
};

/**
 * 緊急（入れ直し）が取り消された（サーバーから取り消したと知らせが来た・この端末で取り消せた）。そのシールを消し、このあと残そうとしても残さない。
 * 刷るべきシールを消さないよう、取り消しの知らせのほかでは呼ばない（注文の一覧から消えたことでは呼ばない）
 */
export const cancelPendingPrint = (id: string) => {
  cancelled.add(id);
  removePendingPrint(id);
};

/** 残りが変わったら呼ぶ（ほかのタブで変わったときも） */
export const subscribePendingPrints = store.subscribe;

/** 残りを送り直すあいだ、同じ端末のほかのタブには送り直させない（同じシールを 2 回刷らないように） */
export const withPendingPrintsLock = store.withLock;
