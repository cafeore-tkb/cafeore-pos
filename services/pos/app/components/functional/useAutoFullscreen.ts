import { useEffect } from "react";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
};
type FullscreenRoot = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

/** 読み込み時に全画面化を試み、操作が必要なブラウザーでは最初の操作で再試行する。 */
export function requestFullscreenOnLoad(doc: FullscreenDocument) {
  const root = doc.documentElement as FullscreenRoot;
  const request = root.requestFullscreen
    ? () => root.requestFullscreen({ navigationUI: "hide" })
    : root.webkitRequestFullscreen?.bind(root);
  if (!request) return () => {};

  let stopped = false;
  let pending = false;
  const isFullscreen = () =>
    Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
  const stop = () => {
    stopped = true;
    doc.removeEventListener("click", onInteraction, true);
    doc.removeEventListener("keydown", onInteraction, true);
    doc.removeEventListener("fullscreenchange", onFullscreenChange);
    doc.removeEventListener("webkitfullscreenchange", onFullscreenChange);
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
      // Escで解除した後は、次の操作で勝手に全画面へ戻さない。
      if (isFullscreen()) stop();
    } catch {
      // 読み込み直後はユーザー操作が無く拒否されるため、次の操作を待つ。
    } finally {
      pending = false;
    }
  };
  function onInteraction(event: Event) {
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      if (
        (key.key !== "Enter" && key.key !== " ") ||
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
    if (isFullscreen()) stop();
  }

  doc.addEventListener("click", onInteraction, true);
  doc.addEventListener("keydown", onInteraction, true);
  doc.addEventListener("fullscreenchange", onFullscreenChange);
  doc.addEventListener("webkitfullscreenchange", onFullscreenChange);
  void enter();
  return stop;
}

export function useAutoFullscreen() {
  useEffect(() => requestFullscreenOnLoad(document), []);
}
