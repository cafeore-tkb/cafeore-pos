import { useEffect } from "react";
import { caosLog, startCaosPageLog } from "../utils/log";

/** ポータルのダイアログを含め、操作画面を開いている間の入力と端末の状態を追う。 */
export const useCaosActivityLog = () => {
  useEffect(() => {
    const stopPageLog = startCaosPageLog({
      path: location.pathname,
      online: navigator.onLine,
    });
    const interaction = (event: Event) => {
      const element = event.target;
      if (!(element instanceof Element)) return;
      const target =
        element.closest(
          "button, input, select, textarea, [role='button'], [draggable], [data-search-key], [data-bay-target], [role='tab'], [aria-pressed], a",
        ) ?? element;
      const input =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement;
      caosLog(`ui.${event.type}`, {
        isTrusted: event.isTrusted,
        tag: target.tagName,
        pointer:
          event instanceof PointerEvent
            ? { type: event.pointerType, x: event.clientX, y: event.clientY }
            : undefined,
        role: target.getAttribute("role"),
        label:
          target.getAttribute("aria-label") ??
          target.getAttribute("title") ??
          (input ? undefined : target.textContent?.trim().slice(0, 120)),
        id: target.id || undefined,
        data: target instanceof HTMLElement ? { ...target.dataset } : undefined,
        // 入力の内容は保存せず、変更があったことを記録する。
        inputType: target instanceof HTMLInputElement ? target.type : undefined,
      });
    };
    const status = (event: Event) =>
      caosLog(`page.${event.type}`, {
        online: navigator.onLine,
        visibility: document.visibilityState,
      });
    const error = (event: ErrorEvent) =>
      caosLog("page.error", {
        message: event.message,
        file: event.filename,
        line: event.lineno,
        stack: event.error instanceof Error ? event.error.stack : undefined,
      });
    const rejection = (event: PromiseRejectionEvent) =>
      caosLog("page.unhandled-rejection", {
        reason:
          event.reason instanceof Error
            ? { message: event.reason.message, stack: event.reason.stack }
            : String(event.reason),
      });
    const pendingScrolls = new Map<Element, ReturnType<typeof setTimeout>>();
    const logScroll = (target: Element) =>
      caosLog("ui.scroll", {
        tag: target.tagName,
        id: target.id || undefined,
        data: target instanceof HTMLElement ? { ...target.dataset } : undefined,
        left: target.scrollLeft,
        top: target.scrollTop,
      });
    const scroll = (event: Event) => {
      const target =
        event.target instanceof Element
          ? event.target
          : document.scrollingElement;
      if (!target) return;
      clearTimeout(pendingScrolls.get(target));
      pendingScrolls.set(
        target,
        setTimeout(() => {
          pendingScrolls.delete(target);
          logScroll(target);
        }, 200),
      );
    };
    document.addEventListener("scroll", scroll, {
      capture: true,
      passive: true,
    });
    const keyboard = (event: KeyboardEvent) => {
      if (
        [
          "Escape",
          "Enter",
          "Tab",
          "ArrowLeft",
          "ArrowRight",
          "ArrowUp",
          "ArrowDown",
        ].includes(event.key)
      )
        caosLog("ui.keydown", {
          isTrusted: event.isTrusted,
          key: event.key,
          tag:
            event.target instanceof Element ? event.target.tagName : undefined,
        });
    };
    document.addEventListener("keydown", keyboard, true);
    const inputs = [
      "click",
      "change",
      "input",
      "pointerdown",
      "pointerup",
      "pointercancel",
      "dragstart",
      "drop",
    ];
    for (const name of inputs)
      document.addEventListener(name, interaction, true);
    for (const name of ["online", "offline", "pagehide", "pageshow"])
      window.addEventListener(name, status);
    document.addEventListener("visibilitychange", status);
    window.addEventListener("error", error);
    window.addEventListener("unhandledrejection", rejection);
    return () => {
      stopPageLog();
      document.removeEventListener("keydown", keyboard, true);
      document.removeEventListener("scroll", scroll, true);
      for (const [target, timer] of pendingScrolls) {
        clearTimeout(timer);
        logScroll(target);
      }
      for (const name of inputs)
        document.removeEventListener(name, interaction, true);
      for (const name of ["online", "offline", "pagehide", "pageshow"])
        window.removeEventListener(name, status);
      document.removeEventListener("visibilitychange", status);
      window.removeEventListener("error", error);
      window.removeEventListener("unhandledrejection", rejection);
    };
  }, []);
};
