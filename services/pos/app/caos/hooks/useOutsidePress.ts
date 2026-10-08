import { useEffect, useRef } from "react";

// 開いているもの（1〜6 のボタン・詳細のパネルなど）の外を押したら onOutside を呼ぶ。
// isInside で「中」を決める（押した要素を受け取る）。enabled が false のあいだは見ない。
export const useOutsidePress = (
  enabled: boolean,
  isInside: (target: HTMLElement) => boolean,
  onOutside: () => void,
) => {
  const latest = useRef({ isInside, onOutside });
  latest.current = { isInside, onOutside };
  useEffect(() => {
    if (!enabled) return;
    const handlePress = (event: PointerEvent) => {
      if (!latest.current.isInside(event.target as HTMLElement))
        latest.current.onOutside();
    };
    document.addEventListener("pointerdown", handlePress);
    return () => document.removeEventListener("pointerdown", handlePress);
  }, [enabled]);
};
