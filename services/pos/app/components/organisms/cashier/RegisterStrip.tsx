import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "~/lib/utils";

type props = {
  /** 会計の段階か。会計の段階では帯を左に送る */
  paying: boolean;
  menu: ReactNode;
  order: ReactNode;
  breakdown: ReactNode;
  /** 会計の段階で、薄くしたメニューを押した（会計を取り消すか尋ねる） */
  onMenuWhilePaying: () => void;
};

/**
 * レジの左の 2 列。メニュー｜商品（384px）｜内訳 を横に並べた帯。
 * 入れる段階は メニュー｜商品 を見せる。会計の段階は商品と内訳を内訳の幅だけ左に送り、
 * 薄くしたメニュー｜商品｜内訳 を見せる（商品の列を左に押し出し、内訳が真ん中に入る）。
 * メニューは左端に置いたまま（帯と逆に送って打ち消す）薄くし、商品の列がその上に重なる。
 *
 * 内訳の幅は商品の列と同じ 384px。狭い画面（iPad など）では、メニューが 120px 以上残るよう細くする
 * （--breakdown。帯の見える幅 100cqw − 商品の列 384px − 120px）。どの列も大きさは変えずに動かすだけ。
 * 見えていない列と、薄くしたメニューの中は押せず、Tab でも止まらない（inert）。
 * 帯の外はスクロールでも見せない（overflow-clip）
 */
export const RegisterStrip = ({
  paying,
  menu,
  order,
  breakdown,
  onMenuWhilePaying,
}: props) => (
  <div className="@container col-span-2 min-h-0 min-w-0 overflow-clip">
    <div
      className={cn(
        "grid h-full grid-cols-[calc(100cqw_-_384px)_384px_var(--breakdown)] grid-rows-[minmax(0,1fr)] transition-transform duration-300 ease-out [--breakdown:clamp(0px,calc(100cqw_-_504px),384px)] motion-reduce:transition-none",
        paying && "-translate-x-[var(--breakdown)]",
      )}
    >
      <div
        className={cn(
          "relative grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] transition-transform duration-300 ease-out motion-reduce:transition-none",
          // 帯と同じだけ逆に送り、メニューは左端から動かさない
          paying && "translate-x-[var(--breakdown)]",
        )}
      >
        <StripSlot
          inert={paying}
          className={cn(
            "transition-opacity duration-300 motion-reduce:transition-none",
            paying && "opacity-30",
          )}
        >
          {menu}
        </StripSlot>
        {paying && (
          // 薄くしたメニューの上を覆い、押したら会計を取り消すか尋ねる（キーボードでは Esc で取り消す）
          <button
            type="button"
            tabIndex={-1}
            aria-label="会計を取り消す"
            onClick={onMenuWhilePaying}
            className="absolute inset-0 cursor-pointer"
          />
        )}
      </div>
      {/* 会計の段階では、動かさないメニューの右側に重なる */}
      <div className="relative z-[1] grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
        {order}
      </div>
      <StripSlot inert={!paying}>{breakdown}</StripSlot>
    </div>
  </div>
);

/** 帯の 1 列。inert の間は押せず Tab でも止まらない（React 18 は inert を属性で渡せないので、DOM に直に付ける） */
const StripSlot = ({
  inert,
  className,
  children,
}: {
  inert: boolean;
  className?: string;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = inert;
  }, [inert]);
  return (
    <div
      ref={ref}
      className={cn(
        "grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]",
        className,
      )}
    >
      {children}
    </div>
  );
};
