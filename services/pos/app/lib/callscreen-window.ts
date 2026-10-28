import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CmItem,
  type CmPlaylist,
  getCmPlaylist,
  subscribeCmPlaylist,
} from "./callscreen-cm";
import type { ScreenDetailed } from "./screens";

// 呼び出し画面の窓（/callscreen?display）。設定の画面（/callscreen）が、選んだ外部ディスプレイいっぱいに新しい窓で開く。
//
// 全画面（Fullscreen API）にはしない。Chrome は、ファイルを選ぶダイアログを出すと、開いた・開かれた関係にある窓の全画面を
// 解く（noopener で開いても、開いた側として覚えている）。全画面にすると、設定の画面で CM のファイルを選ぶたびに解けるため。
// お客さんに窓の枠を見せたくなければ、呼び出し画面の窓で F11（Mac は ⌃⌘F）を押す（ブラウザの全画面は解かれない）。
//
// CM のファイルは設定の画面のタブのメモリにしか無いので、設定の画面が今の並びを postMessage で送る
// （blob: の URL は設定の画面が作ったものを、同じオリジンの窓もそのまま読める）。音の設定は localStorage にあるので両方に効く。
// 呼び出し画面の窓は、開いてから一度クリックしないと音（チャイム・読み上げ）が鳴らない（ブラウザの自動再生の制限）。
// 鳴らせるかを窓が知らせ、設定の画面に出す

/** 呼び出し画面の窓で開くページ */
export const DISPLAY_PATH = "/callscreen?display";
/** 呼び出し画面の窓の名前。もう開いていれば、新しく開かずにその窓を使う */
const DISPLAY_NAME = "cafeore-callscreen-display";
/**
 * 呼び出し画面の窓が設定の画面に知らせる間隔。設定の画面を読み込み直しても、次の知らせでつなぎ直す
 * （読み込み直した設定の画面は、前に開いた窓を知らないため）
 */
const HEARTBEAT_MS = 3_000;
/** 呼び出し画面の窓が閉じたかを見る間隔（閉じたことは知らせが来ないこともあるので見に行く） */
const CLOSED_CHECK_MS = 1_000;

/** 送るものに付ける印。ほかの postMessage（拡張機能など）と取り違えないため */
const SOURCE = "cafeore:callscreen-window";

/** 呼び出し画面の窓から設定の画面へ */
export type DisplayMessage =
  /** 開いている。今の並びを送ってほしい。音を鳴らせるか（窓を一度クリックしたか）も知らせる */
  | { type: "hello"; soundReady: boolean }
  /** 閉じる・読み込み直す */
  | { type: "bye" };

/** 設定の画面から呼び出し画面の窓へ。今の CM の並び */
export type HostState = { type: "state"; playlist: CmPlaylist };

const wrap = (message: DisplayMessage | HostState) => ({
  source: SOURCE,
  ...message,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** 呼び出し画面の窓からの知らせを読む。形の違うもの・ほかから来たものは null */
export const parseDisplayMessage = (data: unknown): DisplayMessage | null => {
  if (!isRecord(data) || data.source !== SOURCE) return null;
  if (data.type === "bye") return { type: "bye" };
  if (data.type === "hello" && typeof data.soundReady === "boolean") {
    return { type: "hello", soundReady: data.soundReady };
  }
  return null;
};

const isCmItem = (value: unknown): value is CmItem =>
  isRecord(value) &&
  typeof value.id === "string" &&
  typeof value.name === "string" &&
  (value.kind === "video" || value.kind === "image") &&
  typeof value.type === "string" &&
  typeof value.url === "string";

/** 設定の画面から届いたものを読む。形の違うもの・ほかから来たものは null */
export const parseHostState = (data: unknown): HostState | null => {
  if (!isRecord(data) || data.source !== SOURCE || data.type !== "state") {
    return null;
  }
  const { playlist } = data;
  if (
    !isRecord(playlist) ||
    !Array.isArray(playlist.items) ||
    !playlist.items.every(isCmItem) ||
    typeof playlist.imageSeconds !== "number"
  ) {
    return null;
  }
  return {
    type: "state",
    playlist: { items: playlist.items, imageSeconds: playlist.imageSeconds },
  };
};

/** 窓を置く場所と大きさ。その画面の使える広さ（タスクバー・メニューバーを除いた広さ）いっぱい */
export type WindowBounds = Pick<
  ScreenDetailed,
  "availLeft" | "availTop" | "availWidth" | "availHeight"
>;

/** window.open に渡す位置と大きさ */
export const windowFeatures = (bounds: WindowBounds) =>
  `left=${bounds.availLeft},top=${bounds.availTop},width=${bounds.availWidth},height=${bounds.availHeight}`;

/** このウィンドウのある画面の使える広さ（画面を選べないブラウザ用。availLeft・availTop が無ければ 0） */
export const currentScreenBounds = (): WindowBounds => {
  const screen = window.screen as Screen & Partial<WindowBounds>;
  return {
    availLeft: screen.availLeft ?? 0,
    availTop: screen.availTop ?? 0,
    availWidth: screen.availWidth,
    availHeight: screen.availHeight,
  };
};

/** source が、このページ（読み込み直す前を含む）が開いた窓か */
const isOpenedByThis = (
  source: MessageEventSource | null,
): source is Window => {
  try {
    return (source as Window | null)?.opener === window;
  } catch {
    return false;
  }
};

const sendState = (target: Window) =>
  target.postMessage(
    wrap({ type: "state", playlist: getCmPlaylist() }),
    window.location.origin,
  );

/**
 * 設定の画面の側。呼び出し画面の窓を開き・動かし・閉じ、CM の並びが変わるたびに送る。
 * 窓が開いているか（open）と、音を鳴らせるか（soundReady）を返す
 */
export function useCallScreenWindow() {
  const [display, setDisplay] = useState<Window | null>(null);
  const [soundReady, setSoundReady] = useState(true);
  const displayRef = useRef(display);
  displayRef.current = display;

  // 窓からの知らせ。読み込み直す前にこのページが開いた窓も、知らせが来たらつなぎ直す
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (!isOpenedByThis(event.source)) return;
      const message = parseDisplayMessage(event.data);
      if (!message) return;
      const source = event.source;
      if (message.type === "bye") {
        if (source === displayRef.current) setDisplay(null);
        return;
      }
      setDisplay(source);
      setSoundReady(message.soundReady);
      sendState(source);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  // CM の並びが変わるたびに送る。窓が閉じたら忘れる
  useEffect(() => {
    if (!display) return;
    const unsubscribe = subscribeCmPlaylist(() => sendState(display));
    const timer = setInterval(() => {
      if (display.closed) setDisplay(null);
    }, CLOSED_CHECK_MS);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [display]);

  /**
   * 呼び出し画面の窓を bounds いっぱいに開く。もう開いていれば、開き直さずにそこへ動かす。
   * クリックの中で呼ぶこと。開けなければ（ポップアップを止められた）false
   */
  const show = useCallback((bounds: WindowBounds) => {
    const opened = displayRef.current;
    const target =
      opened && !opened.closed
        ? opened
        : window.open(DISPLAY_PATH, DISPLAY_NAME, windowFeatures(bounds));
    if (!target) return false;
    // 開いていた窓（読み込み直す前に開いたものを名前で拾ったときも）は位置を変えないので、ここで動かす
    try {
      target.moveTo(bounds.availLeft, bounds.availTop);
      target.resizeTo(bounds.availWidth, bounds.availHeight);
    } catch {
      // 動かせなくても、開けてはいる
    }
    setDisplay(target);
    return true;
  }, []);

  const close = useCallback(() => {
    displayRef.current?.close();
    setDisplay(null);
  }, []);

  return { open: display !== null, soundReady, show, close };
}

/**
 * 呼び出し画面の窓の側。開いた設定の画面（window.opener）に知らせ、届いた CM の並びを返す。
 * 設定の画面から開いていない・設定の画面を閉じたときは null（置いてある CM を流す）
 */
export function useHostPlaylist(soundReady: boolean) {
  const [playlist, setPlaylist] = useState<CmPlaylist | null>(null);

  useEffect(() => {
    const host = window.opener as Window | null;
    if (!host) return;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.source !== host) {
        return;
      }
      const state = parseHostState(event.data);
      if (state) setPlaylist(state.playlist);
    };
    const bye = () =>
      host.postMessage(wrap({ type: "bye" }), window.location.origin);
    window.addEventListener("message", onMessage);
    window.addEventListener("pagehide", bye);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("pagehide", bye);
    };
  }, []);

  // 開いたとき・音を鳴らせるようになったとき・その後も一定の間隔で知らせる
  useEffect(() => {
    const host = window.opener as Window | null;
    if (!host) return;
    const hello = () => {
      // 設定の画面を閉じたら、その CM のファイルはもう読めないので置いてある CM に戻す
      if (host.closed) {
        setPlaylist(null);
        return;
      }
      host.postMessage(
        wrap({ type: "hello", soundReady }),
        window.location.origin,
      );
    };
    hello();
    const timer = setInterval(hello, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [soundReady]);

  return playlist;
}

/**
 * この窓で音を鳴らせるか。一度クリックする（キーを押す）までは鳴らせない（ブラウザの自動再生の制限）。
 * 分からないブラウザ（navigator.userActivation が無い）では鳴らせるとみなす
 */
export function useSoundReady() {
  const [ready, setReady] = useState(
    () => navigator.userActivation?.hasBeenActive ?? true,
  );

  useEffect(() => {
    if (ready) return;
    const unlock = () => setReady(true);
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [ready]);

  return ready;
}
