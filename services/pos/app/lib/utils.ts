import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// 複製したときの名前。元と見分けられるようにする
export const copyName = (name: string) => `${name}のコピー`;
