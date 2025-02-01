import { Outlet } from "@remix-run/react";
import { auth, login, logout } from "common/firebase-utils/firebase";
import { type User, onAuthStateChanged } from "firebase/auth";
import { useEffect, useState } from "react";
import { useOnlineStatus } from "~/components/functional/useOnlineStatus";
import { useOrderStat } from "~/components/functional/useOrderStat";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

export default function BaseHeader() {
  const [user, setUser] = useState<User | null>(null);
  const isOnline = useOnlineStatus();
  const isOperational = useOrderStat();

  useEffect(() => {
    onAuthStateChanged(auth, (user) => {
      if (user?.emailVerified) {
        setUser(user);
      } else {
        setUser(null);
      }
    });
  }, []);

  return (
    <div>
      <header
        className={cn(
          "sticky top-0 z-10 h-2",
          "flex items-center justify-center",
          "group overflow-hidden hover:h-14",
          isOnline && "bg-green-600",
          !isOnline && "h-min bg-red-700",
          !isOperational && "h-min bg-violet-600",
          !user && "h-min bg-yellow-600",
        )}
      >
        {!isOnline && (
          <div className="p-2 text-center text-white">
            オフラインです。操作は反映されません
          </div>
        )}
        {!isOperational && (
          <div className="p-2 text-center text-white">オーダーストップ中</div>
        )}
        {!user && (
          <div className="flex items-center justify-center">
            <div className="m-2 text-center text-white">
              未ログイン状態です。書き込みができません
            </div>
            <Button className="m-2 bg-green-700" onClick={login}>
              ログイン
            </Button>
          </div>
        )}
        {user && (
          <Button
            className="invisible bg-red-600 group-hover:visible"
            onClick={logout}
          >
            ログアウト
          </Button>
        )}
      </header>
      <Outlet />
    </div>
  );
}

// cacher.tsx -> _header.cacher.tsx と変更することで
// cacher.tsx ページに対して上記ヘッダーを付与することができる
// 子となったcacher.tsxの中身が <Outlet /> に入るイメージ
