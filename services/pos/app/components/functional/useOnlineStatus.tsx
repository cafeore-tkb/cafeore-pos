import { API_BASE_URL } from "@cafeore/common";
import { useEffect, useState } from "react";

const HEALTH_CHECK_INTERVAL_MS = 10_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const STATUS_CHECK_URL = `${API_BASE_URL.replace(/\/$/, "")}/status`;
const backendHostname = new URL(API_BASE_URL).hostname;
const IS_LOCAL_BACKEND = ["localhost", "127.0.0.1", "::1"].includes(
  backendHostname,
);

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
        });
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
