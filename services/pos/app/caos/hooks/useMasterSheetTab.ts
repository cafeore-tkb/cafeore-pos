import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { caosLog } from "../utils/log";

// 操作画面の所有権。送信処理だけで使う caos-sender:v2 とは別にする。
const EDITOR_LOCK = "cafeore:caos-editor:v1";
const LEGACY_SENDER_LOCK = "cafeore:caos-outbox:";

type TabState =
  | "checking"
  | "active"
  | "duplicate"
  | "legacy"
  | "unsupported"
  | "error";

/** 同一オリジン・ブラウザの操作タブを1つに限定する。保存領域の空き容量には依存しない。 */
export const useMasterSheetTab = () => {
  const [state, setState] = useState<TabState>("checking");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    setState("checking");
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let hiddenByNavigation = false;
    let release: (() => void) | undefined;
    const timeout = setTimeout(() => {
      cancelled = true;
      release?.();
      setState("error");
      caosLog("page.editor-blocked", { reason: "timeout", attempt });
    }, 8_000);
    const report = (next: TabState) => {
      if (cancelled) return;
      clearTimeout(timeout);
      setState(next);
      caosLog(
        next === "active" ? "page.editor-acquired" : "page.editor-blocked",
        { reason: next, attempt },
      );
    };

    // StrictMode の最初の setup/cleanup では取得を始めない。
    void Promise.resolve()
      .then(async () => {
        if (cancelled) return;
        if (!navigator.locks?.request || !navigator.locks.query) {
          report("unsupported");
          return;
        }
        await navigator.locks.request(
          EDITOR_LOCK,
          { ifAvailable: true },
          async (lock) => {
            if (cancelled) return;
            if (!lock) {
              report("duplicate");
              return;
            }
            // 更新前のタブは editor ロックを知らない。旧送信ロックの保有も調べる。
            const snapshot = await navigator.locks.query();
            if (cancelled) return;
            if (
              [...(snapshot.held ?? []), ...(snapshot.pending ?? [])].some(
                ({ name }) => name === LEGACY_SENDER_LOCK,
              )
            ) {
              report("legacy");
              return;
            }
            const released = new Promise<void>((resolve) => {
              release = resolve;
            });
            report("active");
            // 別タブが前面になっただけでは手放さない。操作と送信の多重起動を防ぐ。
            await released;
          },
        );
      })
      .catch((error) => {
        if (!cancelled) {
          report("error");
          caosLog("page.editor-error", { error: String(error) });
        }
      });

    const pagehide = () => {
      hiddenByNavigation = true;
      cancelled = true;
      clearTimeout(timeout);
      // bfcacheへ入る前に操作UI・送信処理を終了してから所有権を返す。
      // 単なる visibilitychange（別タブ・画面ロック）では終了しない。
      flushSync(() => setState("checking"));
      release?.();
    };
    const pageshow = () => {
      if (hiddenByNavigation) retry();
    };
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      release?.();
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("pageshow", pageshow);
    };
  }, [attempt, retry]);

  return { state, retry };
};
