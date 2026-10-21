import type { ButtonHTMLAttributes, ReactNode } from "react";

/** 既存のカード操作と同じ、表示されているカード領域の中央。 */
export const CardActionTray = ({
  inset = "0px",
  children,
}: {
  inset?: string;
  children: ReactNode;
}) => (
  <div
    data-caos-action-tray
    style={{ left: inset }}
    className="pointer-events-none absolute inset-y-0 right-0 z-[90] flex items-center justify-center"
  >
    <div className="pointer-events-auto flex shrink-0 gap-3 rounded-2xl bg-slate-950/70 p-2 shadow-xl">
      {children}
    </div>
  </div>
);

/** 通常メニュー・常設の候補ともに直径40px。 */
export const CardActionButton = ({
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    type="button"
    {...props}
    className={`flex h-10 w-10 shrink-0 touch-manipulation items-center justify-center rounded-full bg-white font-black text-lg text-slate-950 active:scale-90 disabled:opacity-40 ${className}`}
  />
);
