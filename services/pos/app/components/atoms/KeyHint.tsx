import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

type props = {
  children: ReactNode;
  /** 色の付いた地（黒・紺のボタン）の上に出す */
  inverted?: boolean;
  className?: string;
};

/** ボタンに添える、押すキーの札（Enter・Space・商品キーなど） */
export const KeyHint = ({ children, inverted, className }: props) => (
  <span
    className={cn(
      "rounded border px-1.25 py-0.75 font-mono font-semibold text-[11px] leading-none",
      inverted
        ? "border-white/45 text-white/85"
        : "border-stone-300 bg-white text-stone-500",
      className,
    )}
  >
    {children}
  </span>
);
