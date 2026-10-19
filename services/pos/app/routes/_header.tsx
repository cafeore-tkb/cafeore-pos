import { useLayoutEffect, useRef, useState } from "react";
import { Outlet, useMatches } from "react-router";
import {
  type HeaderOutletContext,
  type StatusBarHandle,
  connectionIssues,
} from "~/components/functional/connectionIssues";
import { useOnlineStatus } from "~/components/functional/useOnlineStatus";
import { useOrderStat } from "~/components/functional/useOrderStat";
import { cn } from "~/lib/utils";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export default function BaseHeader() {
  const statusRef = useRef<HTMLElement>(null);
  const [statusHeight, setStatusHeight] = useState(0);
  useLayoutEffect(() => {
    const element = statusRef.current;
    if (!element) return;
    const update = () =>
      setStatusHeight(element.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const {
    isOnline,
    isDeviceOnline,
    isBackendOnline,
    isDatabaseOnline,
    isInternetConnectionRequired,
  } = useOnlineStatus();
  const isOperational = useOrderStat();
  const { status: wsStatus } = useOrdersWSContext();
  // オフライン時は WebSocket も当然切れるので、オフラインの表示だけにする
  const isWsDisconnected = isOnline && wsStatus === "closed";
  const issues = connectionIssues({
    isBackendOnline,
    isDatabaseOnline,
    isDeviceOnline,
    isInternetConnectionRequired,
    isWsDisconnected,
  });
  // レジはつながっていないものをヘッダーに出すので、バーは色だけにする
  const compact = useMatches().some(
    (match) => (match.handle as StatusBarHandle | undefined)?.compactStatusBar,
  );
  const outletContext: HeaderOutletContext = { connectionIssues: issues };

  return (
    <div
      style={
        { "--pos-status-height": `${statusHeight}px` } as React.CSSProperties
      }
    >
      <header
        ref={statusRef}
        data-pos-status-bar
        className={cn(
          "sticky top-0 z-30 h-2",
          "flex items-center justify-center",
          isOnline && "bg-green-600",
          isWsDisconnected && "bg-orange-600",
          !isOnline && "bg-red-700",
          !compact && issues.length > 0 && "h-min",
          !isOperational && "h-min bg-violet-600",
        )}
      >
        {!compact &&
          issues.map((issue) => (
            <div key={issue.key} className="p-2 text-center text-white">
              {issue.message}
            </div>
          ))}
        {!isOperational && (
          <div className="p-2 text-center text-white">オーダーストップ中</div>
        )}
      </header>
      <Outlet context={outletContext} />
    </div>
  );
}

// cacher.tsx -> _header.cacher.tsx と変更することで
// cacher.tsx ページに対して上記ヘッダーを付与することができる
// 子となったcacher.tsxの中身が <Outlet /> に入るイメージ
