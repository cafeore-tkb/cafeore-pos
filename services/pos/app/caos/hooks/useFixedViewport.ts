import { useEffect } from "react";

// 拡大しない viewport（入力欄を押したときの自動の拡大も止める）
const FIXED_VIEWPORT = "maximum-scale=1, user-scalable=no";

// Safari だけが出す、2 本の指の手ぶりの知らせ
const GESTURES = ["gesturestart", "gesturechange"] as const;
const preventDefault = (event: Event) => event.preventDefault();

/** iPad の Safari が caos.css だけでは止めないピンチと、入力欄の自動の拡大を止める（CaOS の画面を開いているあいだだけ） */
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
