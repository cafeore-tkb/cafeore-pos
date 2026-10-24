import { API_BASE_URL, apiClient } from "@cafeore/common";
import { useEffect, useState } from "react";

const HEALTH_CHECK_INTERVAL_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
// ログインのセッションを確かめる間隔（下の reloadForLogin）。
// /status（10 秒ごと）より空けている。確かめる先は画面を返すサーバー（Cloud Run の web・Workers）で、
// 10 秒ごとだと端末 1 台あたり 1 日 8,640 回、30 秒ごとなら 2,880 回になる。
// 切れてから気づくまで最大で 30 秒ほどで、その間の API の呼び出しは失敗する
const SESSION_CHECK_INTERVAL_MS = 30_000;
const SESSION_CHECK_PATH = "/session-check";
const backendHostname = new URL(API_BASE_URL).hostname;
const IS_LOCAL_BACKEND = ["localhost", "127.0.0.1", "::1"].includes(
  backendHostname,
);
// ログインのセッション切れで再読み込みした時刻。続けて読み込み直さないために覚えておく
const LOGIN_RELOAD_KEY = "cafeore:login-reload-at";
const LOGIN_RELOAD_INTERVAL_MS = 60_000;

// 本番は画面と API が同じオリジン（https://pos.cafeore.cafe）にあり、その手前でログインを求めている
// （GCP の LB の IAP。GCP に移すまでは Cloudflare Access。README の「API の認証」「POS を GCP に移す」）。
// セッションが切れると、API への fetch と WebSocket がログイン画面へ飛ばされて失敗し続け、画面は自分では戻らない。
//
// なので、ときどき /session-check を確かめる。画面を返すサーバーが 204 を返すだけのもの
// （Cloud Run の web は server/app.ts、Workers は worker/index.ts）で、ログインの内側にある。
// X-Requested-With を付けると、セッションが切れているときに IAP も Access もログイン画面へ飛ばさずに
// 401 を返すので、そのときは画面を読み込み直してログインへ戻す。
//
// /status では確かめない。GCP では /status はログインの外（LB が IAP を通さずに api へ回す）にあり、401 にならない。
const reloadForLogin = () => {
  try {
    const last = Number(sessionStorage.getItem(LOGIN_RELOAD_KEY) ?? 0);
    // 読み込み直してもまだ 401 なら、セッション切れ以外の何か。繰り返さない
    if (Date.now() - last < LOGIN_RELOAD_INTERVAL_MS) {
      return;
    }
    sessionStorage.setItem(LOGIN_RELOAD_KEY, String(Date.now()));
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
    let sessionController: AbortController | undefined;
    let requestId = 0;
    // 画面と API が同じオリジンなら、本番のログインの内側にいる（上の reloadForLogin）。
    // ローカルと PR のプレビューは API が別のオリジンで、ログインも無い。
    // window はビルド時（SPA の index.html の生成）には無いので、ここで見る
    const isBehindLogin =
      new URL(API_BASE_URL).origin === window.location.origin;

    const checkSession = async () => {
      sessionController?.abort();
      const currentController = new AbortController();
      sessionController = currentController;
      const timeoutId = window.setTimeout(
        () => currentController.abort(),
        HEALTH_CHECK_TIMEOUT_MS,
      );
      try {
        const response = await fetch(SESSION_CHECK_PATH, {
          cache: "no-store",
          headers: { "X-Requested-With": "XMLHttpRequest" },
          // ログイン画面へ飛ばされたら追わずに、飛ばされたことだけを受け取る
          redirect: "manual",
          signal: currentController.signal,
        });
        if (response.status === 401 || response.type === "opaqueredirect") {
          reloadForLogin();
        }
      } catch {
        // つながらないときは /status の方で分かるので、ここでは何もしない
      } finally {
        window.clearTimeout(timeoutId);
      }
    };

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
        const { data, response } = await apiClient.GET("/status", {
          cache: "no-store",
          signal: currentController.signal,
        });
        if (!data) {
          throw new Error(`Status check failed: ${response.status}`);
        }

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

    const handleOnline = () => {
      void checkBackendConnection();
      if (isBehindLogin) {
        void checkSession();
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
    let sessionIntervalId: number | undefined;
    if (isBehindLogin) {
      void checkSession();
      sessionIntervalId = window.setInterval(
        checkSession,
        SESSION_CHECK_INTERVAL_MS,
      );
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      disposed = true;
      controller?.abort();
      sessionController?.abort();
      window.clearInterval(intervalId);
      window.clearInterval(sessionIntervalId);
      window.removeEventListener("online", handleOnline);
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
