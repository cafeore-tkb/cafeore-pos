import { API_BASE_URL } from "@cafeore/common";
import { useEffect, useState } from "react";

const HEALTH_CHECK_INTERVAL_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const STATUS_CHECK_URL = `${API_BASE_URL.replace(/\/$/, "")}/status`;
const backendHostname = new URL(API_BASE_URL).hostname;
const IS_LOCAL_BACKEND = ["localhost", "127.0.0.1", "::1"].includes(
  backendHostname,
);
// Access のセッション切れで再読み込みした時刻。続けて読み込み直さないために覚えておく
const ACCESS_RELOAD_KEY = "cafeore:access-reload-at";
const ACCESS_RELOAD_INTERVAL_MS = 60_000;

// 本番は API を POS の Worker が中継していて（同じオリジン）、その手前に
// Cloudflare Access がいる。セッションが切れると Access が API への fetch と
// WebSocket をログイン画面へ飛ばすので、通信は失敗し続け、画面は自分では戻らない。
//
// /status は API では認証しないので、ここが 401 になるのは Access のセッション切れ
// だけ（X-Requested-With を付けると、Access は飛ばさずに 401 を返す）。そのときは
// 画面を読み込み直して Access のログインへ戻す。
const reloadForAccessLogin = () => {
  try {
    const last = Number(sessionStorage.getItem(ACCESS_RELOAD_KEY) ?? 0);
    // 読み込み直してもまだ 401 なら、セッション切れ以外の何か。繰り返さない
    if (Date.now() - last < ACCESS_RELOAD_INTERVAL_MS) {
      return;
    }
    sessionStorage.setItem(ACCESS_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage が使えないときは、続けて読み込み直さないよう諦める
    return;
  }
  window.location.reload();
};

type OnlineStatus = {
  isDeviceOnline: boolean;
  isBackendOnline: boolean | null;
  isDatabaseOnline: boolean | null;
};

const ONLINE_STATUS: OnlineStatus = {
  isDeviceOnline: true,
  isBackendOnline: true,
  isDatabaseOnline: true,
};

// 戻り値はオブジェクトにしておく。真偽値を返す形だと、状態を増やしたときに
// 古い呼び出し側が `if (useOnlineStatus())` のまま常に真になり、型でも気づけない
export const useOnlineStatus = () => {
  const [onlineStatus, setOnlineStatus] = useState(ONLINE_STATUS);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    let requestId = 0;
    // window はビルド時（SPA の index.html の生成）には無いので、ここで見る
    const isBehindAccess =
      new URL(STATUS_CHECK_URL).origin === window.location.origin;

    const checkBackendConnection = async () => {
      controller?.abort();
      const currentRequestId = ++requestId;

      const currentController = new AbortController();
      controller = currentController;
      const timeoutId = window.setTimeout(
        () => currentController.abort(),
        HEALTH_CHECK_TIMEOUT_MS,
      );

      try {
        const response = await fetch(STATUS_CHECK_URL, {
          cache: "no-store",
          signal: currentController.signal,
          // 別オリジン（ローカル・プレビュー）に付けると CORS の preflight が要るので、
          // Worker 経由のときだけ付ける
          headers: isBehindAccess
            ? { "X-Requested-With": "XMLHttpRequest" }
            : undefined,
        });
        if (isBehindAccess && response.status === 401) {
          reloadForAccessLogin();
        }
        if (!response.ok) {
          throw new Error(`Status check failed: ${response.status}`);
        }
        const data = (await response.json()) as { database?: unknown };

        if (!disposed && currentRequestId === requestId) {
          setOnlineStatus({
            isDeviceOnline: navigator.onLine,
            isBackendOnline: true,
            isDatabaseOnline: data.database === "connected",
          });
        }
      } catch {
        if (!disposed && currentRequestId === requestId) {
          setOnlineStatus({
            isDeviceOnline: navigator.onLine,
            isBackendOnline: false,
            isDatabaseOnline: null,
          });
        }
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

    const handleOffline = () => {
      setOnlineStatus((currentStatus) => ({
        ...currentStatus,
        isDeviceOnline: false,
      }));
      void checkBackendConnection();
    };

    void checkBackendConnection();

    const intervalId = window.setInterval(
      checkBackendConnection,
      HEALTH_CHECK_INTERVAL_MS,
    );
    window.addEventListener("online", checkBackendConnection);
    window.addEventListener("offline", handleOffline);

    return () => {
      disposed = true;
      controller?.abort();
      window.clearInterval(intervalId);
      window.removeEventListener("online", checkBackendConnection);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return {
    ...onlineStatus,
    isInternetConnectionRequired: !IS_LOCAL_BACKEND,
    isOnline:
      (IS_LOCAL_BACKEND || onlineStatus.isDeviceOnline) &&
      onlineStatus.isBackendOnline === true &&
      onlineStatus.isDatabaseOnline === true,
  };
};
