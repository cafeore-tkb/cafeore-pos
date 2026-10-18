import { useSyncExternalStore } from "react";

// 呼び出し画面で鳴らす音（チャイム・読み上げ・読み上げのエコー）。マスタ設定の「呼び出し画面の CM」（/callscreen-cm）で切り替える。
// 呼び出しの読み上げとドリップの案内は、提供画面のヘッダーでも切り替えられる。
// 呼び出し催促だけは、どの設定でもチャイムと読み上げを鳴らす（announcementSound）。
//
// この端末の localStorage に覚える。読み込み直しても残り、同じ端末のほかのタブで開いている呼び出し画面にもすぐ効く。
// 書けないときは、このタブの中だけで持つ。

export interface CallScreenSound {
  /** 呼び出しの前のチャイム（呼び出し催促は切っていても鳴らす） */
  chime: boolean;
  /** 呼び出しの読み上げ。切ってもチャイムは chime のとおり鳴らす（呼び出し催促は切っていても読み上げる） */
  callVoice: boolean;
  /** ドリップの案内の読み上げ */
  dripVoice: boolean;
  /** 読み上げにかけるエコー */
  echo: boolean;
  /** エコーの強さ。返す声の大きさ（読み上げの声を 100 として、%） */
  echoLevel: number;
}

/** あり・なしで切り替えるもの */
export type CallScreenSoundFlag = "chime" | "callVoice" | "dripVoice" | "echo";

export const ECHO_LEVEL_MIN = 5;
export const ECHO_LEVEL_MAX = 50;
export const ECHO_LEVEL_STEP = 5;

const STORAGE_KEY = "cafeore:callscreen-sound";

export const CALL_SCREEN_SOUND_DEFAULT: CallScreenSound = {
  chime: true,
  callVoice: true,
  dripVoice: true,
  echo: true,
  echoLevel: 10,
};

/**
 * 覚えたものを読む。無い・形の違う項目は既定のまま。エコーの強さは ECHO_LEVEL_MIN〜MAX の、ECHO_LEVEL_STEP 刻みに丸める。
 * 呼び出しとドリップの案内を分ける前は 1 つの voice で両方を切り替えていたので、どちらも無ければ voice を使う
 */
export const parseCallScreenSound = (value: unknown): CallScreenSound => {
  const stored: Record<string, unknown> =
    typeof value === "object" && value !== null ? { ...value } : {};
  const flag = (key: CallScreenSoundFlag, legacyKey?: string) => {
    const flagValue = stored[key];
    if (typeof flagValue === "boolean") return flagValue;
    const legacyValue = legacyKey === undefined ? undefined : stored[legacyKey];
    return typeof legacyValue === "boolean"
      ? legacyValue
      : CALL_SCREEN_SOUND_DEFAULT[key];
  };
  const level = stored.echoLevel;
  return {
    chime: flag("chime"),
    callVoice: flag("callVoice", "voice"),
    dripVoice: flag("dripVoice", "voice"),
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

/** 読み上げの種類（呼び出し・呼び出し催促・ドリップの案内） */
export type AnnouncementKind = "call" | "recall" | "drip";

/**
 * 今の設定で、その読み上げのチャイムと声を鳴らしてよいか（チャイムは、もともとチャイムを付ける案内のときだけ鳴らす）。
 * 呼び出し催促は、お客様が呼び出しに気づいていないときに押すものなので、設定に関わらずどちらも鳴らす
 */
export const announcementSound = (
  kind: AnnouncementKind,
  sound: CallScreenSound,
): { chime: boolean; voice: boolean } => {
  if (kind === "recall") return { chime: true, voice: true };
  return {
    chime: sound.chime,
    voice: kind === "drip" ? sound.dripVoice : sound.callVoice,
  };
};

/** 読み上げをどちらか流すか（エコーと、読み上げの音声を先に作らせるかを決める） */
export const hasCallScreenVoice = (sound: CallScreenSound) =>
  sound.callVoice || sound.dripVoice;
