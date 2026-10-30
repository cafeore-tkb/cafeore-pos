import { useEffect } from "react";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
};
type FullscreenRoot = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

const INTERACTIVE_TAGS = new Set([
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
  "A",
  "VIDEO",
  "AUDIO",
  "SUMMARY",
]);
const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "combobox",
  "checkbox",
  "radio",
  "switch",
  "slider",
  "spinbutton",
  "listbox",
  "menuitem",
]);
// WebKitが戻り値も完了・エラー通知も返さない場合、後の操作で再試行できるようにする。
const NOTIFICATION_TIMEOUT_MS = 2000;

/** 読み込み時に全画面化を試み、操作が必要なブラウザーでは最初の操作で再試行する。 */
export function requestFullscreenOnLoad(doc: FullscreenDocument) {
  const root = doc.documentElement as FullscreenRoot;
  const request = root.requestFullscreen
    ? () => root.requestFullscreen({ navigationUI: "hide" })
    : root.webkitRequestFullscreen?.bind(root);
  if (!request) return () => {};

  let stopped = false;
  let pending = false;
  let notificationTimer: ReturnType<typeof setTimeout> | undefined;
  const isFullscreen = () =>
    Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
  const releasePending = () => {
    pending = false;
    clearTimeout(notificationTimer);
    notificationTimer = undefined;
  };
  const stop = () => {
    stopped = true;
    releasePending();
    doc.removeEventListener("click", onInteraction);
    doc.removeEventListener("keydown", onInteraction);
    doc.removeEventListener("fullscreenchange", onFullscreenChange);
    doc.removeEventListener("webkitfullscreenchange", onFullscreenChange);
    doc.removeEventListener("fullscreenerror", releasePending);
    doc.removeEventListener("webkitfullscreenerror", releasePending);
  };
  const enter = async () => {
    if (stopped || pending) return;
    if (isFullscreen()) {
      stop();
      return;
    }
    pending = true;
    try {
      await request();
      if (stopped || !pending) return;
      // Escで解除した後は、次の操作で勝手に全画面へ戻さない。
      if (isFullscreen()) stop();
      // voidを返すWebKitでは、戻り値ではなく後から届く通知を待つ。
      else
        notificationTimer = setTimeout(releasePending, NOTIFICATION_TIMEOUT_MS);
    } catch {
      // 読み込み直後はユーザー操作が無く拒否されるため、次の操作を待つ。
      releasePending();
    }
  };
  function onInteraction(event: Event) {
    if (
      event.defaultPrevented ||
      event.composedPath().some((target) => {
        // composedPathで子要素やShadow DOM内からの操作も判定する。
        const element = target as HTMLElement;
        return (
          INTERACTIVE_TAGS.has(element.tagName) ||
          element.isContentEditable ||
          INTERACTIVE_ROLES.has(element.getAttribute?.("role") ?? "")
        );
      })
    )
      return;
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      if (
        (key.key !== "Enter" && key.key !== " ") ||
        key.isComposing ||
        key.keyCode === 229 ||
        key.repeat ||
        key.altKey ||
        key.ctrlKey ||
        key.metaKey
      )
        return;
    }
    void enter();
  }
  function onFullscreenChange() {
    // 動画など別要素の全画面表示も尊重し、解除後に自動で入り直さない。
    if (isFullscreen()) stop();
  }

  // Reactの操作ハンドラーがpreventDefaultした結果を確認できるようバブリングで監視する。
  doc.addEventListener("click", onInteraction);
  doc.addEventListener("keydown", onInteraction);
  doc.addEventListener("fullscreenchange", onFullscreenChange);
  doc.addEventListener("webkitfullscreenchange", onFullscreenChange);
  doc.addEventListener("fullscreenerror", releasePending);
  doc.addEventListener("webkitfullscreenerror", releasePending);
  void enter();
  return stop;
}

export function useAutoFullscreen() {
  useEffect(() => requestFullscreenOnLoad(document), []);
}
