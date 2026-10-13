import { useCallback, useEffect, useState } from "react";
import { soundManager } from "../utils/audio";
import { useDeviceSetting } from "./useDeviceSetting";

// 閲覧だけの画面の通知音（タイムラインに新しく入ったカードの知らせ。useTimelineArrivals が鳴らす）。
// 鳴らすかはヘッダーで切り替え、この端末に覚える。iPad は画面に触れた中でないと音を出せるようにならないので、
// 音ありのときは、画面のどこかに触れたら出せるようにする（それまではヘッダーに「触れると鳴る」と出す）。

export const useViewSound = () => {
  const [on, setOn] = useDeviceSetting("caos-view-sound", false);
  const [ready, setReady] = useState(soundManager.ready);
  // 鳴らすか（soundManager.enabled）は、この画面を開いている間だけ切り替える（操作の画面の音の設定は変えない）
  useEffect(() => {
    const before = soundManager.enabled;
    soundManager.enabled = on;
    return () => {
      soundManager.enabled = before;
    };
  }, [on]);
  const unlock = useCallback(
    () => soundManager.unlock().then(() => setReady(soundManager.ready)),
    [],
  );
  useEffect(() => {
    if (!on || ready) return;
    window.addEventListener("pointerup", unlock);
    return () => window.removeEventListener("pointerup", unlock);
  }, [on, ready, unlock]);

  return {
    on,
    /** 音を出せる（音ありで、画面に触れたあと） */
    ready,
    /** 音あり・なしを切り替える。音ありにしたら確かめに 1 回鳴らす。音ありでまだ出せないときは、出せるようにするだけ */
    toggle: () => {
      if (on && !ready) {
        void unlock();
        return;
      }
      soundManager.enabled = !on;
      if (!on) {
        void unlock();
        soundManager.playComplete();
      }
      setOn(!on);
    },
  };
};

export type ViewSound = ReturnType<typeof useViewSound>;
