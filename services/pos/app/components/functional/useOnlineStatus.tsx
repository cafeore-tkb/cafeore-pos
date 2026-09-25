import { useSyncExternalStore } from "react";

const subscribe = (callback: () => void) => {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
};

// 戻り値はオブジェクトにしておく。真偽値を返す形だと、状態を増やしたときに
// 古い呼び出し側が `if (useOnlineStatus())` のまま常に真になり、型でも気づけない
export const useOnlineStatus = () => {
  const isOnline = useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
  return { isOnline };
};
