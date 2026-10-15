import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

// 開いているもの（1〜6 のボタン・詳細のパネルなど）の外を押したら onOutside を呼ぶ。
// 押したのは click で見る（pointerdown で閉じると帯が消えて下がずれ、指を離したときに押したボタンが指の下に無い）。
// document の capture で受けるので、閉じるのは押したものの onClick の前（押した先はもう決まっているので、ずれてもそのボタンが効く）。
// swallow なら、外を押した click は押した先に届けない（閉じるだけ）。
// 外でドラッグ・スクロールしただけでは閉じない。isInside で「中」を決める（押した要素を受け取る）。enabled が false のあいだは見ない。
export const useOutsidePress = (
  enabled: boolean,
  isInside: (target: HTMLElement) => boolean,
  onOutside: () => void,
  { swallow = false }: { swallow?: boolean } = {},
) => {
  const latest = useRef({ isInside, onOutside });
  useLayoutEffect(() => {
    latest.current = { isInside, onOutside };
  });
  useEffect(() => {
    if (!enabled) return;
    const handleClick = (event: MouseEvent) => {
      if (latest.current.isInside(event.target as HTMLElement)) return;
      latest.current.onOutside();
      if (!swallow) return;
      event.stopPropagation();
      event.preventDefault();
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [enabled, swallow]);
};

// 上に重ねて出るもの（確かめ・ダイアログとその後ろの幕・通知）。ほかのパネルから見ると「中」
const LAYERS =
  "dialog, [role='dialog'], [role='alertdialog'], [data-caos-backdrop], [data-sonner-toaster]";

/**
 * 開いたパネル・ダイアログ（ref）の外を押したら onClose。外を押した 1 回目は閉じるだけで、その下のカード・盤面のボタンには届けない。
 * 上に重ねて出ているほかのもの（LAYERS。ダイアログの後ろの幕も）を押したときは閉じない。
 * パネルの中の入力欄で打っているあいだに外を押したら、入力を終える（キーボードを閉じる）だけで閉じない（入れたものを消さない）
 */
export const usePanelOutsidePress = (
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
) =>
  useOutsidePress(
    enabled,
    (target) => {
      const panel = ref.current;
      if (!panel || panel.contains(target)) return true;
      const layer = target.closest(LAYERS);
      return layer !== null && !layer.contains(panel);
    },
    () => {
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        ref.current?.contains(focused) &&
        focused.matches(
          "textarea, input:not([type='checkbox'], [type='radio'], [type='file'])",
        )
      )
        focused.blur();
      else onClose();
    },
    { swallow: true },
  );
