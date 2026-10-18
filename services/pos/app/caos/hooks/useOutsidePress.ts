import { type RefObject, useEffect, useLayoutEffect, useRef } from "react";

// 開いているもの（1〜6 のボタン・詳細のパネルなど）の外を押したら onOutside を呼ぶ。
// 押したのは click で見る（pointerdown で閉じると帯が消えて下がずれ、指を離したときに押したボタンが指の下に無い）。
// document の capture で受けるので、閉じるのは押したものの onClick の前（押した先はもう決まっているので、ずれてもそのボタンが効く）。
// swallow なら、外を押した click は押した先に届けない（閉じるだけ）。
// 外でドラッグ・スクロールしただけでは閉じない。isInside で「中」を決める（押した要素を受け取る。右下のコメントの置き場はいつも閉じない）。enabled が false のあいだは見ない。
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
      const target = event.target as HTMLElement;
      // 右下のコメントの置き場（CommentDock）は盤面の上に重ねたもので、押しても開いているものを閉じない
      if (target.closest("[data-comment-dock], [data-popup-tray]")) return;
      if (latest.current.isInside(target)) return;
      latest.current.onOutside();
      if (!swallow) return;
      event.stopPropagation();
      event.preventDefault();
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [enabled, swallow]);
};

// 上に重ねて出るもの（右上の確かめと知らせ・ダイアログとその後ろの幕・POS の通知）。ほかのパネルから見ると「中」
const LAYERS =
  "dialog, [role='dialog'], [role='alertdialog'], [data-caos-layer], [data-caos-backdrop], [data-sonner-toaster]";

// 文字を打つ入力欄
const TEXT_INPUT =
  "textarea, input:not([type='checkbox'], [type='radio'], [type='file'])";

/**
 * 開いたパネル・ダイアログ（ref）の外を押したら onClose。外を押した 1 回目は閉じるだけで、その下のカード・盤面のボタンには届けない。
 * 上に重ねて出ているほかのもの（LAYERS。ダイアログの後ろの幕も）を押したときは閉じない。
 * パネルの中の入力欄で打っているあいだに外を押したら、入力を終える（キーボードを閉じる）だけで閉じない（入れたものを消さない）。
 * 打っていたかは押し始め（pointerdown）で見る（マウスでは click の前にフォーカスが外れるので）
 */
export const usePanelOutsidePress = (
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  enabled = true,
) => {
  const typing = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const handleDown = () => {
      const focused = document.activeElement;
      typing.current =
        focused instanceof HTMLElement &&
        ref.current?.contains(focused) &&
        focused.matches(TEXT_INPUT)
          ? focused
          : null;
    };
    document.addEventListener("pointerdown", handleDown, true);
    return () => document.removeEventListener("pointerdown", handleDown, true);
  }, [enabled, ref]);
  useOutsidePress(
    enabled,
    (target) => {
      const panel = ref.current;
      if (
        !panel ||
        panel.closest("[data-popup-hidden='true']") ||
        panel.contains(target)
      )
        return true;
      const layer = target.closest(LAYERS);
      return layer !== null && !layer.contains(panel);
    },
    () => {
      if (typing.current) typing.current.blur();
      else onClose();
      typing.current = null;
    },
    { swallow: true },
  );
};
