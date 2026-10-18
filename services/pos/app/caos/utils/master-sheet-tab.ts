const EDITOR_LOCK = "cafeore:caos-editor:v1";
const LEGACY_SENDER_LOCK = "cafeore:caos-outbox:";

export type MasterSheetTabState =
  | "checking"
  | "active"
  | "duplicate"
  | "legacy"
  | "unsupported"
  | "error";

/** 操作タブの所有権。Reactから独立させ、ブラウザーのライフサイクルもここで扱う。 */
export const createMasterSheetTabSession = ({
  onState,
  onPageHide = () => onState("checking"),
  log,
}: {
  onState: (state: MasterSheetTabState) => void;
  /** 所有権を返す前に、操作UIと送信処理を同期的に終了する。 */
  onPageHide?: () => void;
  log: (event: string, details: Record<string, unknown>) => void;
}) => {
  const page = window;
  let stopped = false;
  let suspended = false;
  let attempt = 0;
  let disposeAttempt = () => {};

  const acquire = () => {
    disposeAttempt();
    onState("checking");
    const currentAttempt = attempt++;
    let cancelled = false;
    let release: (() => void) | undefined;
    const timeout = setTimeout(() => {
      cancelled = true;
      release?.();
      onState("error");
      log("page.editor-blocked", {
        reason: "timeout",
        attempt: currentAttempt,
      });
    }, 8_000);
    const report = (next: MasterSheetTabState) => {
      if (cancelled) return;
      clearTimeout(timeout);
      onState(next);
      log(next === "active" ? "page.editor-acquired" : "page.editor-blocked", {
        reason: next,
        attempt: currentAttempt,
      });
    };
    disposeAttempt = () => {
      cancelled = true;
      clearTimeout(timeout);
      release?.();
    };

    // StrictMode の最初の setup/cleanup では取得を始めない。
    void Promise.resolve()
      .then(async () => {
        if (cancelled) return;
        const locks = navigator.locks;
        if (typeof locks?.request !== "function") {
          report("unsupported");
          return;
        }
        await locks.request(
          EDITOR_LOCK,
          { ifAvailable: true },
          async (lock) => {
            if (cancelled) return;
            if (!lock) {
              report("duplicate");
              return;
            }
            const released = new Promise<void>((resolve) => {
              release = resolve;
            });
            const checkAndHold = async () => {
              // 更新前の画面は editor ロックを知らないため、旧送信ロックも確認。
              let legacyBusy: boolean;
              if (typeof locks.query === "function") {
                const snapshot = await locks.query();
                legacyBusy = [
                  ...(snapshot.held ?? []),
                  ...(snapshot.pending ?? []),
                ].some(({ name }) => name === LEGACY_SENDER_LOCK);
              } else {
                // query が無くても request で重複を防げる。待機・強奪はしない。
                legacyBusy = await locks.request(
                  LEGACY_SENDER_LOCK,
                  { ifAvailable: true },
                  (legacyLock) => !legacyLock,
                );
              }
              if (cancelled) return;
              if (legacyBusy) {
                report("legacy");
                return;
              }
              report("active");
              await released;
            };
            // query自体が戻らなくても、終了・タイムアウトでは操作ロックを返す。
            await Promise.race([checkAndHold(), released]);
          },
        );
      })
      .catch((error) => {
        if (!cancelled) {
          report("error");
          log("page.editor-error", { error: String(error) });
        }
      });
  };

  const retry = () => {
    if (!stopped && !suspended) acquire();
  };
  const pagehide = () => {
    suspended = true;
    // bfcacheへ入る前に、操作UI・送信処理を終了してから所有権を返す。
    onPageHide();
    disposeAttempt();
  };
  const pageshow = () => {
    if (suspended && !stopped) {
      suspended = false;
      acquire();
    }
  };
  page.addEventListener("pagehide", pagehide);
  page.addEventListener("pageshow", pageshow);
  acquire();

  return {
    retry,
    stop: () => {
      stopped = true;
      disposeAttempt();
      page.removeEventListener("pagehide", pagehide);
      page.removeEventListener("pageshow", pageshow);
    },
  };
};
