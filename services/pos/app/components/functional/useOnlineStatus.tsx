import { API_BASE_URL, apiClient } from "@cafeore/common";
import { useEffect, useState } from "react";

const HEALTH_CHECK_INTERVAL_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const backendHostname = new URL(API_BASE_URL).hostname;
const IS_LOCAL_BACKEND = ["localhost", "127.0.0.1", "::1"].includes(
  backendHostname,
);
// ログインのセッション切れで再読み込みした時刻。続けて読み込み直さないために覚えておく
// （鍵の名前は Cloudflare Access のころのまま）
const LOGIN_RELOAD_KEY = "cafeore:access-reload-at";
const LOGIN_RELOAD_INTERVAL_MS = 60_000;

// 本番は画面と API が同じオリジン（https://pos.cafeore.cafe）で、その手前でログインを
// 求めている。GCP の LB の IAP（LB が /api・/status・/health を API の Cloud Run へ、
// それ以外を画面の Cloud Run へ送る）で、その前は Cloudflare Access（API は POS の Worker が
// 中継）だった。どちらもセッションが切れると API への fetch と WebSocket をログイン画面
// （Google・Access）へ飛ばすので、通信は失敗し続け、画面は自分では戻らない。
//
// どちらも X-Requested-With: XMLHttpRequest を付けた fetch は、ログイン画面へ飛ばさずに
// 401 を返す。/status は API では認証しないので、ここが 401 になるのはセッション切れだけ。
// そのときは画面を読み込み直してログインへ戻す（Google にログインしたままなら、IAP は
// 何も聞かずに画面へ戻す）。
//
//   - IAP が /status に 401 を返すのは、/status を受ける API のバックエンド（LB）にも IAP が
//     付いているとき。画面の方にだけ付けると、ここは働かない
//   - IAP の 403 は、ログインはしているが POS を使う権限が無いとき。読み込み直しても変わらない
//     ので、ここでは扱わない
//   - PR のプレビュー（Workers）とローカルは API が別のオリジンで、ログインも無いので働かない
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
    let requestId = 0;
    // window はビルド時（SPA の index.html の生成）には無いので、ここで見る。
    // 本番（画面も API も https://pos.cafeore.cafe）だけが同じオリジンになる
    const isBehindLogin =
      new URL(API_BASE_URL).origin === window.location.origin;

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
          // 別オリジン（ローカル・プレビュー）に付けると CORS の preflight が要るので、
          // 同じオリジン（本番）のときだけ付ける
          headers: isBehindLogin
            ? { "X-Requested-With": "XMLHttpRequest" }
            : undefined,
        });
        if (isBehindLogin && response.status === 401) {
          reloadForLogin();
        }
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
