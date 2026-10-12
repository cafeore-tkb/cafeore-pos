import { createDeviceStore } from "~/lib/device-store";
import type { PrintJob } from "./document";

/**
 * 刷れなかったシール。刷れるまでこの端末に残し、送り直す（print-util の usePrinter）。
 * 置き方は ~/lib/device-store（1 件ずつ localStorage に置き、タブを閉じても残り、同じ端末のタブどうしで共有する）
 */
export type PendingPrint = { id: string; at: number; job: PrintJob };

// 置いたものの形か（壊れたもの・ほかが書いたものは送らない）
const parse = (id: string, value: unknown): PendingPrint | null =>
  typeof value === "object" &&
  value !== null &&
  "at" in value &&
  typeof value.at === "number" &&
  "job" in value &&
  typeof value.job === "object" &&
  value.job !== null &&
  "labels" in value.job &&
  Array.isArray(value.job.labels)
    ? { id, at: value.at, job: value.job as PrintJob }
    : null;

const store = createDeviceStore("cafeore:pending-label-print:", parse);

// このタブで取り消しを知った緊急の id。刷っている間に取り消されたら、刷れなくても残さない
const cancelled = new Set<string>();

/** 残っているシール（古い順） */
export const readPendingPrints = store.read;

/** id は後で消すときの目印（緊急のシールは入れ直しの id。取り消したら消す）。無ければ新しく作る */
export const addPendingPrint = (
  job: PrintJob,
  id: string = crypto.randomUUID(),
) => {
  if (cancelled.has(id)) return;
  store.put({ id, at: Date.now(), job });
};

export const removePendingPrint = store.remove;

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
