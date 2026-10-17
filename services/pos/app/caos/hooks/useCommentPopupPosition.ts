import { useLayoutEffect, useState } from "react";

export type CommentAnchor = { element: HTMLElement; rect: DOMRect };

/** 押した場所の上下で空きの多い方へ配置し、画面内に収める。 */
export const useCommentPopupPosition = (anchor?: CommentAnchor) => {
  const [popup, setPopup] = useState<HTMLElement | null>(null);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !popup) return;
    const update = () => {
      const viewport = window.visualViewport;
      const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
      const topEdge = Math.max(64, (viewport?.offsetTop ?? 0) + 8);
      const rightEdge =
        (viewport?.offsetLeft ?? 0) +
        (viewport?.width ?? window.innerWidth) -
        8;
      const bottomEdge =
        (viewport?.offsetTop ?? 0) +
        (viewport?.height ?? window.innerHeight) -
        8;
      popup.style.maxWidth = `${Math.max(0, rightEdge - leftEdge)}px`;
      popup.style.maxHeight = `${Math.max(0, bottomEdge - topEdge)}px`;
      const rect = anchor.element.isConnected
        ? anchor.element.getBoundingClientRect()
        : anchor.rect;
      const width = popup.offsetWidth;
      const height = popup.offsetHeight;
      const below = bottomEdge - rect.bottom - 8;
      const above = rect.top - topEdge - 8;
      const wantedTop =
        below >= height || below >= above
          ? rect.bottom + 8
          : rect.top - height - 8;
      setPosition({
        left: Math.max(
          leftEdge,
          Math.min(rect.left + rect.width / 2 - width / 2, rightEdge - width),
        ),
        top: Math.max(topEdge, Math.min(wantedTop, bottomEdge - height)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(popup);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
    };
  }, [anchor, popup]);
  return {
    element: popup,
    ref: setPopup,
    style: anchor
      ? {
          position: "fixed" as const,
          left: position?.left ?? 8,
          top: position?.top ?? 64,
          width: 340,
          overflowY: "auto" as const,
          visibility: position ? ("visible" as const) : ("hidden" as const),
        }
      : undefined,
  };
};
