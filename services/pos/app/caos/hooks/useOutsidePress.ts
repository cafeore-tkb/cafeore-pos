import { useEffect, useLayoutEffect, useRef } from "react";

// 開いているもの（1〜6 のボタン・詳細のパネルなど）の外を押したら onOutside を呼ぶ。
// 押したのは click で見る（pointerdown で閉じると帯が消えて下がずれ、指を離したときに押したボタンが指の下に無い）。
// document の capture で受けるので、閉じるのは押したものの onClick の前（押した先はもう決まっているので、ずれてもそのボタンが効く）。
// 外でドラッグ・スクロールしただけでは閉じない。isInside で「中」を決める（押した要素を受け取る。右下のコメントの置き場はいつも閉じない）。enabled が false のあいだは見ない。
export const useOutsidePress = (
  enabled: boolean,
  isInside: (target: HTMLElement) => boolean,
  onOutside: () => void,
) => {
  const latest = useRef({ isInside, onOutside });
  useLayoutEffect(() => {
    latest.current = { isInside, onOutside };
  });
  useEffect(() => {
    if (!enabled) return;
    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // 右下のコメントの置き場（CommentDock）は盤面の上に重ねたもので、押しても開いているものを閉じない
      if (target.closest("[data-comment-dock]")) return;
      if (!latest.current.isInside(target)) latest.current.onOutside();
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [enabled]);
};
