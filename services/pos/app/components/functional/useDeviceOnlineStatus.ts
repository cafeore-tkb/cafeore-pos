import { useSyncExternalStore } from "react";

const subscribe = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};

// 端末の接続状態だけを購読する。バックエンドのヘルスチェックは行わない。
export const useDeviceOnlineStatus = () => {
  const isDeviceOnline = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );

  return { isDeviceOnline };
};
