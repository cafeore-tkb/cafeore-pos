import type { CaosPlace } from "@cafeore/common";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isBayId } from "../logic/lanes";

// カードのドラッグ。管制盤 A（タイムラインの待機カード・未割当）・C（未割当）・D（右の注文と表の待機カード）で共通。
// 12px 動くまではタップ。掴んだカードはその場に残し、指には写し（ghost）が付いて動く（スクロールする枠に切られない）。
// 置き先は targetAt（指の下。bayTargetAt など）で決め、離したら onDrop。ドラッグのあとのクリックは捨てる。
const DRAG_THRESHOLD_PX = 12;

/**
 * ドラッグで指の下にあるドリッパー（data-bay-target を持つ列・1〜6 のボタン）。管制盤 A・C・D で共通。
 * 1〜6 のボタンが下にあれば、そのボタンだけで決める（下の列に落ちない）。
 * 列は from（移す前のドリッパー。運んでいるカード自身がその列の中にある）を飛ばして探す。
 */
export const bayTargetAt = (
  clientX: number,
  clientY: number,
  from?: number,
) => {
  const elements = document.elementsFromPoint(clientX, clientY);
  const bayOf = (element: HTMLElement | null | undefined) =>
    Number(element?.dataset.bayTarget);
  const button = elements.find(
    (element): element is HTMLElement =>
      element instanceof HTMLElement &&
      element.matches("button[data-bay-target]"),
  );
  const bayId = button
    ? bayOf(button)
    : bayOf(
        elements
          .map((element) => element.closest<HTMLElement>("[data-bay-target]"))
          .find((element) => {
            const id = bayOf(element);
            return isBayId(id) && id !== from;
          }),
      );
  if (!isBayId(bayId) || bayId === from) return null;
  return bayId;
};

/**
 * ドラッグで落とす先。bayId はドリッパー（列）、place はその列の待機のカードの前（{ beforeKey }）。
 * place が無ければ、その列の待機の最後へ
 */
export interface DropTarget {
  bayId: number;
  place?: CaosPlace;
  /** 前に入れるカードの表示（注文番号） */
  beforeLabel?: string;
}

/**
 * 落とす先（管制盤 A・C）。1〜6 のボタンが下にあればそのボタン（列の最後）、待機のカード（data-queued-ticket）の上ならそのカードの前
 * （同じ列の中の入れ替えにも使う）、ほかは列（最後。bayTargetAt）。運んでいるカード自身（exceptKey）は飛ばす
 */
export const dropTargetAt = (
  clientX: number,
  clientY: number,
  { from, exceptKey }: { from?: number; exceptKey?: string } = {},
): DropTarget | null => {
  const elements = document.elementsFromPoint(clientX, clientY);
  const onButton = elements.some(
    (element) =>
      element instanceof HTMLElement &&
      element.matches("button[data-bay-target]"),
  );
  if (!onButton) {
    for (const element of elements) {
      const ticket = element.closest<HTMLElement>("[data-queued-ticket]");
      const key = ticket?.dataset.queuedTicket;
      if (!ticket || !key || key === exceptKey) continue;
      const bayId = Number(
        ticket.parentElement?.closest<HTMLElement>("[data-bay-target]")?.dataset
          .bayTarget,
      );
      if (!isBayId(bayId)) return null;
      return {
        bayId,
        place: { beforeKey: key },
        beforeLabel: ticket.dataset.ticketLabel,
      };
    }
  }
  const bayId = bayTargetAt(clientX, clientY, from);
  return bayId === null ? null : { bayId };
};

/** 落とす先の札（「→ 3」・「→ 3 #012 の前」） */
export const dropTargetLabel = (target: DropTarget | null) => {
  if (!target) return null;
  return target.beforeLabel
    ? `→ ${target.bayId} ${target.beforeLabel} の前`
    : `→ ${target.bayId}`;
};

export const useCardDrag = <S, T>(handlers: {
  targetAt: (source: S, clientX: number, clientY: number) => T | null;
  onBegin?: (source: S) => void;
  onDrop: (source: S, target: T) => void;
}) => {
  const [drag, setDrag] = useState<{ source: S; rect: DOMRect } | null>(null);
  const [target, setTarget] = useState<T | null>(null);
  const suppressNextClick = useRef(false);
  const endPress = useRef<(() => void) | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const offset = useRef({ x: 0, y: 0 });
  // The window listeners outlive the render that started the press, so they call the
  // latest handlers; otherwise a drop would run App callbacks over stale queues.
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  useEffect(() => () => endPress.current?.(), []);
  // A touch drag ends without a click, so the next press (anywhere) drops any suppression left by it.
  useEffect(() => {
    const reset = () => {
      suppressNextClick.current = false;
    };
    document.addEventListener("pointerdown", reset, true);
    return () => document.removeEventListener("pointerdown", reset, true);
  }, []);

  const placeGhost = () => {
    if (ghostRef.current)
      ghostRef.current.style.transform = `translate3d(${offset.current.x}px, ${offset.current.y}px, 0)`;
  };

  /** カードの onPointerDown。anyDirection が false なら縦の動きはスクロールに任せる（touch-action pan-y のカード） */
  const press = (
    source: S,
    event: React.PointerEvent<HTMLElement>,
    anyDirection = true,
  ) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    // カードの上のボタン（1〜6 など）はそのボタンの操作
    if ((event.target as HTMLElement).closest("button")) return;
    endPress.current?.();

    const { pointerId, clientX: startX, clientY: startY } = event;
    const rect = event.currentTarget.getBoundingClientRect();
    let dragging = false;

    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      // The button was released outside the window, so no pointerup will arrive.
      if (moveEvent.pointerType === "mouse" && moveEvent.buttons === 0) {
        finish(moveEvent, false);
        return;
      }
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        if (!anyDirection && Math.abs(dy) > Math.abs(dx)) return;
        dragging = true;
        latest.current.onBegin?.(source);
        setDrag({ source, rect });
      }
      // Move the ghost directly; the board re-renders only when the drop target changes.
      offset.current = { x: dx, y: dy };
      placeGhost();
      setTarget(
        latest.current.targetAt(source, moveEvent.clientX, moveEvent.clientY),
      );
    };

    const finish = (upEvent: PointerEvent, dropped: boolean) => {
      if (upEvent.pointerId !== pointerId) return;
      cleanup();
      if (!dragging) return;
      setDrag(null);
      setTarget(null);
      suppressNextClick.current = true;
      const dropTarget = dropped
        ? latest.current.targetAt(source, upEvent.clientX, upEvent.clientY)
        : null;
      if (dropTarget !== null) latest.current.onDrop(source, dropTarget);
    };
    const onUp = (upEvent: PointerEvent) => finish(upEvent, true);
    const onCancel = (cancelEvent: PointerEvent) => finish(cancelEvent, false);

    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      endPress.current = null;
    };
    endPress.current = () => {
      cleanup();
      setDrag(null);
      setTarget(null);
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  return {
    /** 運んでいるもの（ドラッグしていなければ null） */
    source: drag?.source ?? null,
    /** 指の下の置き先 */
    target,
    press,
    /** カードの onClickCapture。ドラッグのあとのクリックを捨てる */
    suppressClick: (event: React.MouseEvent) => {
      if (!suppressNextClick.current) return;
      suppressNextClick.current = false;
      event.stopPropagation();
    },
    /** 指に付いて動く写し（content）と、置き先の札（label） */
    ghost: (content: React.ReactNode, label?: string | null) =>
      drag &&
      createPortal(
        <div
          ref={(element) => {
            ghostRef.current = element;
            placeGhost();
          }}
          aria-hidden="true"
          className="caos-root pointer-events-none fixed z-[1000] scale-[1.03] font-sans opacity-90 [&>:first-child]:h-full [&>:first-child]:ring-2 [&>:first-child]:ring-blue-500"
          style={{
            left: drag.rect.left,
            top: drag.rect.top,
            width: drag.rect.width,
            height: drag.rect.height,
          }}
        >
          {content}
          {label && (
            <div className="-right-1 -top-2 absolute z-[130] whitespace-nowrap rounded-full bg-blue-700 px-2 py-1 font-black font-mono text-[12px] text-white shadow-md">
              {label}
            </div>
          )}
        </div>,
        document.body,
      ),
  };
};
