import { useEffect } from "react";

// 拡大しない viewport（入力欄を押したときの自動の拡大も止める）
const FIXED_VIEWPORT = "maximum-scale=1, user-scalable=no";

// Safari だけが出す、2 本の指の手ぶりの知らせ
const GESTURES = ["gesturestart", "gesturechange"] as const;
const preventDefault = (event: Event) => event.preventDefault();

/**
 * iPad で CaOS の画面を拡大させない（開いているあいだだけ）。
 * ページのスクロール・はね返りと、ピンチ・ダブルタップの拡大は caos.css（overflow・overscroll-behavior・touch-action）で止め、
 * iPad の Safari が CSS だけでは止めないピンチと、入力欄の自動の拡大は、ここで viewport と Safari の手ぶりの知らせで止める
 */
export const useFixedViewport = () => {
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="viewport"]',
    );
    const before = meta?.content ?? "";
    if (meta) meta.content = `${before}, ${FIXED_VIEWPORT}`;
    for (const gesture of GESTURES)
      document.addEventListener(gesture, preventDefault, { passive: false });
    return () => {
      if (meta) meta.content = before;
      for (const gesture of GESTURES)
        document.removeEventListener(gesture, preventDefault);
    };
  }, []);
};
