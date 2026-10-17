import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "~/lib/utils";

type props = {
  /** 会計の段階か。会計の段階では帯を左に送る */
  paying: boolean;
  menu: ReactNode;
  order: ReactNode;
  breakdown: ReactNode;
};

/**
 * レジの左の 2 列。メニュー｜商品（384px）｜内訳 を横に並べた帯で、見えるのはそのうち 2 列。
 * 入れる段階は メニュー｜商品、会計の段階は帯を左に送って 商品｜内訳 を見せる
 * （商品の列を左に押し出し、内訳が真ん中に入る）。
 *
 * どの列も大きさは変えずに動かすだけ。メニューと内訳の列は、帯の見える幅から商品の列を引いた幅。
 * 見えていない列は押せず、Tab でも止まらない（inert）。帯の外はスクロールでも見せない（overflow-clip）
 */
export const RegisterStrip = ({ paying, menu, order, breakdown }: props) => (
  <div className="col-span-2 min-h-0 min-w-0 overflow-clip">
    <div
      className={cn(
        "grid h-full grid-cols-[calc(100%_-_384px)_384px_calc(100%_-_384px)] grid-rows-[minmax(0,1fr)] transition-transform duration-300 ease-out motion-reduce:transition-none",
        paying && "-translate-x-[calc(100%_-_384px)]",
      )}
    >
      <StripSlot hidden={paying}>{menu}</StripSlot>
      {order}
      <StripSlot hidden={!paying}>{breakdown}</StripSlot>
    </div>
  </div>
);

/** 帯の 1 列。見えていない間は inert にする（React 18 は inert を属性で渡せないので、DOM に直に付ける） */
const StripSlot = ({
  hidden,
  children,
}: {
  hidden: boolean;
  children: ReactNode;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.inert = hidden;
  }, [hidden]);
  return (
    <div
      ref={ref}
      className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)]"
    >
      {children}
    </div>
  );
};
