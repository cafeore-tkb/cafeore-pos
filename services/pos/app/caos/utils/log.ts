import { isHumanCaosLog, isSystemCaosLog } from "./human-log";
import { enqueueCaosLog } from "./log-transport";

// 送信前のJSONを端末に残し、DBに保存する。再送してもDBでは1行。
// at: 出力時刻（UTC）、tabId: このページ読込の UUID（再読み込みで変わる）、
// sequence: 読込内の連番、event: イベント名、details: イベントごとの内容。
let sequence = 0;
let humanSequence = 0;
let tabId: string | undefined;
export const caosHumanLogSequence = () => humanSequence;
export const caosLog = (event: string, details: unknown = {}) => {
  if (
    typeof window === "undefined" ||
    (!isHumanCaosLog(event, details as Record<string, unknown>) &&
      !isSystemCaosLog(event))
  )
    return;
  try {
    if (isHumanCaosLog(event, details as Record<string, unknown>))
      humanSequence++;
    tabId ??= crypto.randomUUID();
    const entry = {
      at: new Date().toISOString(),
      tabId,
      sequence: ++sequence,
      event,
      details: {
        ...(details as Record<string, unknown>),
        page: typeof location === "undefined" ? undefined : location.pathname,
      },
    };
    const json = JSON.stringify(entry);
    // 呼び出し側のオブジェクトが後で変わっても、当時の値を保存する。
    enqueueCaosLog(JSON.parse(json));
  } catch {
    // ログの失敗で操作を止めない。
  }
};

/** 状態のログだけを内容で比較する。操作・送信の再試行は毎回記録する。 */
export const createCaosStateLog = (log = caosLog) => {
  const previous = new Map<string, string | undefined>();
  return (event: string, details: unknown) => {
    const snapshot = JSON.stringify(details);
    if (previous.has(event) && previous.get(event) === snapshot) return;
    previous.set(event, snapshot);
    log(event, details);
  };
};

/** StrictMode の setup → cleanup → setup が落ち着いてから画面を開いたと記録する。 */
export const startCaosPageLog = (details: unknown, log = caosLog) => {
  let active = true;
  let opened = false;
  queueMicrotask(() => {
    if (!active) return;
    opened = true;
    log("page.open", details);
  });
  return () => {
    active = false;
    if (!opened) return;
    opened = false;
    log("page.close");
  };
};

/** API直呼びの操作も、受付・結果・失敗を同じactionIdでたどれるようにする。 */
export const logCaosAsync = async <T>(
  event: string,
  details: Record<string, unknown>,
  run: () => Promise<T>,
): Promise<T> => {
  const actionId = crypto.randomUUID();
  caosLog(`${event}.requested`, { actionId, ...details });
  try {
    const result = await run();
    caosLog(
      `${event}.${result === false || result === null ? "rejected" : "succeeded"}`,
      { actionId, ...details, result },
    );
    return result;
  } catch (error) {
    caosLog(`${event}.failed`, {
      actionId,
      ...details,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
