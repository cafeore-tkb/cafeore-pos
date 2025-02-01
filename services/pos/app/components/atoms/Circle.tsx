import type { ClassValue } from "clsx";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

type props = {
  focus: boolean;
  children: ReactNode;
  className?: ClassValue;
};

const Circle = ({ focus, children, className }: props) => (
  <div
    className={cn(
      "flex h-12 w-12 items-center justify-center rounded-full border-2 border-stone-500 font-extrabold text-2xl text-stone-500",
      focus && "bg-stone-950 text-white",
      className,
    )}
  >
    {children}
  </div>
);

export { Circle };
