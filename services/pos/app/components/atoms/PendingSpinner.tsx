import { LuLoaderCircle } from "react-icons/lu";
import { cn } from "~/lib/utils";

/**
 * 押した後、サーバーの応答を待っている間だけ角に出す回転アイコン。
 * 表示は押した時点で切り替わっているので、すぐ返るときはちらつかないよう少し遅れて出す。
 * 親に `relative` が必要。
 */
export const PendingSpinner = ({ className }: { className?: string }) => (
  <span
    // 押したボタンの aria-busy で伝わるので、読み上げには出さない
    aria-hidden
    className={cn(
      "fade-in pointer-events-none absolute top-1 right-1 animate-in fill-mode-both duration-200 [animation-delay:300ms]",
      className,
    )}
  >
    <LuLoaderCircle className="h-4 w-4 animate-spin opacity-70" />
  </span>
);
