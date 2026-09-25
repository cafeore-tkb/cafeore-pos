import { Outlet } from "react-router";
import { useOnlineStatus } from "~/components/functional/useOnlineStatus";
import { useOrderStat } from "~/components/functional/useOrderStat";
import { cn } from "~/lib/utils";
import { useOrdersWSContext } from "./context/OrdersWSContext";

export default function BaseHeader() {
  const isOnline = useOnlineStatus();
  const isOperational = useOrderStat();
  const { status: wsStatus } = useOrdersWSContext();
  // オフライン時は WebSocket も当然切れるので、オフラインの表示だけにする
  const isWsDisconnected = isOnline && wsStatus === "closed";

  return (
    <div>
      <header
        className={cn(
          "sticky top-0 z-10 h-2",
          "flex items-center justify-center",
          isOnline && "bg-green-600",
          isWsDisconnected && "h-min bg-orange-600",
          !isOnline && "h-min bg-red-700",
          !isOperational && "h-min bg-violet-600",
        )}
      >
        {!isOnline && (
          <div className="p-2 text-center text-white">
            オフラインです。操作は反映されません
          </div>
        )}
        {isWsDisconnected && (
          <div className="p-2 text-center text-white">
            サーバーと再接続中です。画面が最新でない可能性があります
          </div>
        )}
        {!isOperational && (
          <div className="p-2 text-center text-white">オーダーストップ中</div>
        )}
      </header>
      <Outlet />
    </div>
  );
}

// cacher.tsx -> _header.cacher.tsx と変更することで
// cacher.tsx ページに対して上記ヘッダーを付与することができる
// 子となったcacher.tsxの中身が <Outlet /> に入るイメージ
