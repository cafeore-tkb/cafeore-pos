import { useSyncExternalStore } from "react";

// 呼び出し画面で鳴らす音（チャイム・読み上げ・読み上げのエコー）。マスタ設定の「呼び出し画面の CM」（/callscreen-cm）で切り替える。
//
// この端末の localStorage に覚える。読み込み直しても残り、同じ端末のほかのタブで開いている呼び出し画面にもすぐ効く。
// 書けないときは、このタブの中だけで持つ。

export interface CallScreenSound {
  /** 呼び出しの前のチャイム */
  chime: boolean;
  /** 読み上げ（呼び出し・ドリップの案内） */
  voice: boolean;
  /** 読み上げにかけるエコー */
  echo: boolean;
  /** エコーの強さ。返す声の大きさ（読み上げの声を 100 として、%） */
  echoLevel: number;
}

/** あり・なしで切り替えるもの */
export type CallScreenSoundFlag = "chime" | "voice" | "echo";

export const ECHO_LEVEL_MIN = 5;
export const ECHO_LEVEL_MAX = 50;
export const ECHO_LEVEL_STEP = 5;

const STORAGE_KEY = "cafeore:callscreen-sound";

export const CALL_SCREEN_SOUND_DEFAULT: CallScreenSound = {
  chime: true,
  voice: true,
  echo: true,
  echoLevel: 20,
};

/** 覚えたものを読む。無い・形の違う項目は既定のまま。エコーの強さは ECHO_LEVEL_MIN〜MAX の、ECHO_LEVEL_STEP 刻みに丸める */
export const parseCallScreenSound = (value: unknown): CallScreenSound => {
  const stored: Record<string, unknown> =
    typeof value === "object" && value !== null ? { ...value } : {};
  const flag = (key: CallScreenSoundFlag) => {
    const flagValue = stored[key];
    return typeof flagValue === "boolean"
      ? flagValue
      : CALL_SCREEN_SOUND_DEFAULT[key];
  };
  const level = stored.echoLevel;
  return {
    chime: flag("chime"),
    voice: flag("voice"),
    echo: flag("echo"),
    echoLevel:
      typeof level === "number" && Number.isFinite(level)
        ? Math.min(
            ECHO_LEVEL_MAX,
            Math.max(
              ECHO_LEVEL_MIN,
              Math.round(level / ECHO_LEVEL_STEP) * ECHO_LEVEL_STEP,
            ),
          )
        : CALL_SCREEN_SOUND_DEFAULT.echoLevel,
  };
};

// 読んだもの（変わるまで同じものを返す。useSyncExternalStore にそのまま渡せる）
let cache: CallScreenSound | null = null;
const listeners = new Set<() => void>();

const changed = () => {
  for (const listener of listeners) listener();
};

// ほかのタブで変わったら読み直す（初めて見に来たときから見る）
let watching = false;
const watch = () => {
  if (watching) return;
  watching = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    cache = null;
    changed();
  });
};

const subscribe = (listener: () => void) => {
  watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** 今の設定（React の外で読むとき） */
export const getCallScreenSound = (): CallScreenSound => {
  if (cache) return cache;
  try {
    cache = parseCallScreenSound(
      JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null"),
    );
  } catch {
    cache = CALL_SCREEN_SOUND_DEFAULT;
  }
  return cache;
};

export const setCallScreenSound = (next: CallScreenSound) => {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 覚えられなくても、このタブの中では効く
  }
  changed();
};

/** 呼び出し画面の音の設定（変わると描き直す） */
export const useCallScreenSound = () =>
  useSyncExternalStore(subscribe, getCallScreenSound, getCallScreenSound);
