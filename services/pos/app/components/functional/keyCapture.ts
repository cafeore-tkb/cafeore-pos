import {
  isModifierKey,
  isRegisterKey,
  isSameMenuKey,
  menuKeyError,
} from "~/lib/menuKey";

/**
 * 商品のキーを、実際に押して登録するときに押したキー（`/menu-keys`）
 *
 * レジ（CashierV2 の keydown）と同じく event.key を、離すまで event.code ごとに覚える。
 * Shift などの修飾キーは数えない（Shift は * # などの記号を打つのに使う）。
 * 押すたびにそのとき押しているキーを控え、全部離したら控えたキーを 1 つのキーにする
 * （2 つ以上なら「a+s」の同時押し）。レジも押した時点で押しているキーで同時押しを引くので、
 * 途中で 1 つ離して別のキーを押したら、最後に押したときの組になる
 */
export type KeyCapture = {
  /** 押しているキー（event.code → event.key） */
  held: ReadonlyMap<string, string>;
  /** 最後に押したときに押していたキー（event.key、押した順） */
  keys: readonly string[];
  /** レジでは商品キーにならない押し方をしたときの理由 */
  error: string | null;
};

export type CaptureKeyEvent = Pick<
  KeyboardEvent,
  "code" | "key" | "altKey" | "ctrlKey" | "metaKey" | "isComposing" | "repeat"
>;

export const emptyKeyCapture = (): KeyCapture => ({
  held: new Map(),
  keys: [],
  error: null,
});

/** レジでは商品キーにならない押し方なら、その理由（レジは Ctrl・⌘・日本語入力中のキーを見ない） */
const keyDownError = (event: CaptureKeyEvent): string | null => {
  if (event.isComposing || event.key === "Process") {
    return "日本語入力をオフにしてから押してください";
  }
  if (event.key === "Unidentified" || event.key === "Dead") {
    return "ブラウザで見分けられないキーなので使えません";
  }
  if (event.ctrlKey || event.metaKey) {
    return "Ctrl・⌘ と一緒に押したキーはレジで使えません";
  }
  if (event.altKey) {
    return "Alt と一緒に押すキーは決済手段（Alt+C など）に使うので登録できません";
  }
  return null;
};

export const captureKeyDown = (
  capture: KeyCapture,
  event: CaptureKeyEvent,
): KeyCapture => {
  if (event.repeat || isModifierKey(event.key)) return capture;
  // 全部離してから押したら、押し直し
  const base = capture.held.size === 0 ? emptyKeyCapture() : capture;
  const held = new Map(base.held).set(event.code || event.key, event.key);
  return {
    held,
    // 別の位置の同じキー（テンキーの 1 など）は 1 つと見る（レジも同時押しは同じキーを 1 つと見る）
    keys: [...new Set(held.values())],
    error: base.error ?? keyDownError(event),
  };
};

export const captureKeyUp = (
  capture: KeyCapture,
  event: Pick<KeyboardEvent, "code" | "key">,
): KeyCapture => {
  // macOS では ⌘ を押している間ほかのキーの keyup が来ないので、⌘ を離したら全部離したことにする
  if (event.key === "Meta") return { ...capture, held: new Map() };
  const code = event.code || event.key;
  if (!capture.held.has(code)) return capture;
  const held = new Map(capture.held);
  held.delete(code);
  return { ...capture, held };
};

/** ほかのウィンドウに移ると keyup が届かないので、押している途中なら押し直してもらう */
export const cancelHeldKeys = (capture: KeyCapture): KeyCapture =>
  capture.held.size === 0 ? capture : emptyKeyCapture();

/** 押し終えた（全部離した）キー。押している間・まだ何も押していないときは null */
export const capturedKey = (capture: KeyCapture): string | null =>
  capture.held.size === 0 && capture.keys.length > 0
    ? capture.keys.join("+")
    : null;

export type CapturedKeyCheck =
  | { ok: true; warning: string | null }
  | { ok: false; message: string };

/** 押したキーをそのメニューに登録できるか。他のメニューと同じキーは登録できない（同時押しは押す順を問わない） */
export const checkCapturedKey = (
  key: string,
  menuId: string,
  menus: readonly { id: string; name: string; key: string }[],
): CapturedKeyCheck => {
  const error = menuKeyError(key);
  if (error) return { ok: false, message: error };
  const current = menus.find((menu) => menu.id === menuId);
  if (current && isSameMenuKey(current.key, key)) {
    return { ok: false, message: "今と同じキーです" };
  }
  const taken = menus.find(
    (menu) => menu.id !== menuId && isSameMenuKey(menu.key, key),
  );
  if (taken) {
    return {
      ok: false,
      message: `「${taken.name}」で使われています。先にそちらのキーを変えてください`,
    };
  }
  return {
    ok: true,
    warning: isRegisterKey(key)
      ? "レジの操作（数字・Enter・Space・Esc・Backspace・矢印）に使うキーです。登録するとレジでその操作ができなくなります"
      : null,
  };
};
