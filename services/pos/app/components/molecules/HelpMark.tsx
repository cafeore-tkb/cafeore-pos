import { CircleHelp } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "~/lib/utils";

type props = {
  /** 何の説明か。かざしたときに出し、「〜の説明」として読み上げる */
  title: string;
  /** 説明を「？」の上に開くか、下に開くか */
  side?: "top" | "bottom";
  /** 「？」の大きさ。ヘッダーのような狭い所は sm */
  size?: "sm" | "md";
  /** 開いた説明の幅など */
  panelClassName?: string;
  className?: string;
  children: ReactNode;
};

/** 押すと説明を開く「？」。外を押すか Esc で閉じる */
export const HelpMark = ({
  title,
  side = "bottom",
  size = "md",
  panelClassName,
  className,
  children,
}: props) => {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = () => {
      const details = detailsRef.current;
      if (!details?.open) return;
      details.open = false;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && details.contains(focused))
        focused.blur();
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !detailsRef.current?.contains(event.target)
      )
        close();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !detailsRef.current?.open) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", dismissOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", dismissOnEscape, true);
    };
  }, []);
  return (
    <details ref={detailsRef} className={cn("group relative", className)}>
      <summary
        onKeyDown={(event) => {
          // summary自体の開閉キーだけレジの会計・指名操作と競合させない。
          if (event.key === " " || event.key === "Enter")
            event.stopPropagation();
        }}
        aria-label={`${title}の説明`}
        title={title}
        className={cn(
          "flex cursor-pointer touch-manipulation list-none items-center justify-center rounded-full text-stone-500 hover:bg-stone-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-stone-500 group-open:bg-stone-100 [&::-webkit-details-marker]:hidden",
          size === "md" ? "h-10 w-10" : "h-6 w-6",
        )}
      >
        <CircleHelp
          className={size === "md" ? "h-5 w-5" : "h-4 w-4"}
          aria-hidden="true"
        />
      </summary>
      <div
        className={cn(
          "absolute right-0 z-50 flex max-h-[60vh] max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto whitespace-normal rounded-xl border border-stone-200 bg-white p-4 text-left text-sm text-stone-600 shadow-lg",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
          panelClassName,
        )}
      >
        {children}
      </div>
    </details>
  );
};
