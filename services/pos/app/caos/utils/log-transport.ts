import { type CaosLogEntry, apiClient } from "@cafeore/common";
import { createDeviceStore } from "~/lib/device-store";

type LogEntry = CaosLogEntry;
type PendingLog = { id: string; at: number; entry: LogEntry };
const store = createDeviceStore<PendingLog>(
  "cafeore:caos-log:",
  (id, value) => {
    if (!value || typeof value !== "object") return null;
    const { at, entry } = value as Partial<PendingLog>;
    if (
      typeof at !== "number" ||
      !entry ||
      typeof entry.tabId !== "string" ||
      !Number.isSafeInteger(entry.sequence) ||
      entry.sequence < 1 ||
      typeof entry.at !== "string" ||
      typeof entry.event !== "string" ||
      !entry.details ||
      typeof entry.details !== "object"
    )
      return null;
    return { id, at, entry };
  },
);
let timer: ReturnType<typeof setTimeout> | undefined;
let sending = false;
let retryMs = 1000;
let listening = false;

const schedule = (delay = retryMs) => {
  if (timer !== undefined) return;
  timer = setTimeout(() => {
    timer = undefined;
    void flushCaosLogs();
  }, delay);
};

// 成功を確認するまで残す。複数タブが同じログを送ってもDBの複合主キーで1行になる。
// 画面を閉じるときのkeepaliveは64KB制限があるため、通常も約48KB単位で送る。
export const flushCaosLogs = async () => {
  if (sending || typeof window === "undefined") return;
  const pending = store.read();
  if (!pending.length) return;
  const batch: PendingLog[] = [];
  let size = 32;
  for (const row of pending) {
    const bytes =
      new TextEncoder().encode(JSON.stringify(row.entry)).length + 1;
    if (batch.length && (batch.length >= 100 || size + bytes > 48_000)) break;
    batch.push(row);
    size += bytes;
  }
  sending = true;
  let succeeded = false;
  try {
    const { response } = await apiClient.POST("/api/caos/logs", {
      body: { entries: batch.map((row) => row.entry) },
      keepalive: size <= 60_000,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`ログ保存: HTTP ${response.status}`);
    for (const row of batch) store.remove(row.id);
    retryMs = 1000;
    succeeded = true;
  } catch {
    // 通信失敗で業務操作を止めない。端末に残し、接続回復後にも再送する。
    retryMs = Math.min(retryMs * 2, 30_000);
  } finally {
    sending = false;
    if (store.read().length) schedule(succeeded ? 0 : retryMs);
  }
};

export const enqueueCaosLog = (entry: LogEntry) => {
  store.put({ id: `${entry.tabId}:${entry.sequence}`, at: Date.now(), entry });
  if (!listening) {
    listening = true;
    window.addEventListener("online", () => void flushCaosLogs());
    window.addEventListener("pagehide", () => void flushCaosLogs());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flushCaosLogs();
    });
  }
  schedule();
};
