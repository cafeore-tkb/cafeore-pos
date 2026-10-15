import {
  type CaosCard,
  type CaosPlace,
  caosDripperAllowed,
  caosMergePair,
} from "@cafeore/common";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { type DropSide, dropSideAt, isBayId } from "../logic/lanes";

// カードのドラッグ。管制盤 A（タイムラインの待機カード・未割当）・C（未割当）・D（右の注文と表の待機カード）で共通。
// 12px 動くまではタップ、それより動かすと向きに関係なくすぐ掴む（カードは touch-action none。枠のスクロールは ScrollArea のバー）。
// 掴んだカードはその場に残し、指には写し（ghost）が付いて動く（スクロールする枠に切られない）。
// 置き先は targetAt（指の下。bayTargetAt など）で決め、離したら onDrop。ドラッグのあとのクリックは捨てる。
const DRAG_THRESHOLD_PX = 12;

// 1〜6 のボタン（カードの上の BayPad）
const isBayButton = (element: Element): element is HTMLElement =>
  element instanceof HTMLElement && element.matches("button[data-bay-target]");

/**
 * ドラッグで指の下にあるドリッパー（data-bay-target を持つ列・1〜6 のボタン）。管制盤 A・C・D で共通。
 * 1〜6 のボタンが下にあれば、そのボタンだけで決める（下の列に落ちない）。
 * 列は from（移す前のドリッパー。運んでいるカード自身がその列の中にある）を飛ばして探す。
 * 運んでいるカード（card）を置けないドリッパー（指名の番号でない列。caosDripperAllowed）は null
 */
export const bayTargetAt = (
  clientX: number,
  clientY: number,
  { from, card }: { from?: number; card?: CaosCard } = {},
) => {
  const elements = document.elementsFromPoint(clientX, clientY);
  const bayOf = (element: HTMLElement | null | undefined) =>
    Number(element?.dataset.bayTarget);
  const button = elements.find(isBayButton);
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
  if (card && !caosDripperAllowed(card, bayId)) return null;
  return bayId;
};

/**
 * ドラッグで落とす先。bayId はドリッパー（列）、place はその列のどこか（列のカードの前 { beforeKey }・後ろ { afterKey }。
 * 抽出中のカードの前は列の先頭（今から始まる）、後ろは待機の先頭）。place が無ければ、その列の待機の最後へ。
 * mergeKey があれば、そのカード（待機・抽出中）に統合する。near は指の下の列のカード（札と、前後の線・統合の印を出す）
 */
export interface DropTarget {
  bayId: number;
  place?: CaosPlace;
  /** 統合する相手のカード（key） */
  mergeKey?: string;
  near?: {
    /** 指の下の列のカード（key） */
    key: string;
    side: DropSide;
    /** そのカードの表示（注文番号） */
    label: string;
    /** そのカードが抽出中（前は今から始める、後ろは待機の先頭） */
    brewing: boolean;
  };
}

/**
 * 落とす先（管制盤 A・C・D）。1〜6 のボタンが下にあればそのボタン（列の最後）。列の待機・抽出中のカード（data-queued-ticket）の上なら、
 * 左の端はそのカードの前・右の端は後ろ・真ん中は統合（運んでいるカード card と統合できる（caosMergePair。cards から引く。
 * 運んでいるのが抽出中なら相手を抽出中のカードに入れる）ときだけ。できなければ近いほうの端。logic/lanes の dropSideAt）。
 * 同じ列の中の入れ替えにも使う。ほかは列（最後。bayTargetAt）。運んでいるカード自身は飛ばし、置けない列は null。
 * merge が false なら統合しない（前か後ろだけ）
 */
export const dropTargetAt = (
  clientX: number,
  clientY: number,
  {
    from,
    card,
    cards = [],
    merge = true,
  }: {
    from?: number;
    card?: CaosCard;
    cards?: readonly CaosCard[];
    merge?: boolean;
  } = {},
): DropTarget | null => {
  const elements = document.elementsFromPoint(clientX, clientY);
  if (!elements.some(isBayButton)) {
    for (const element of elements) {
      const ticket = element.closest<HTMLElement>("[data-queued-ticket]");
      const key = ticket?.dataset.queuedTicket;
      if (!ticket || !key || key === card?.key) continue;
      const bayId = Number(
        ticket.parentElement?.closest<HTMLElement>("[data-bay-target]")?.dataset
          .bayTarget,
      );
      if (!isBayId(bayId)) return null;
      const into = cards.find((other) => other.key === key);
      const pair = merge && card && into ? caosMergePair(card, into) : null;
      const rect = ticket.getBoundingClientRect();
      const side = dropSideAt((clientX - rect.left) / rect.width, {
        mergeable: pair !== null,
        placeable: !card || caosDripperAllowed(card, bayId),
      });
      if (!side) return null;
      const near = {
        key,
        side,
        label: ticket.dataset.ticketLabel ?? "",
        brewing: into?.status === "brewing",
      };
      // 統合したカードの場所（運んでいるのが抽出中なら、そのドリッパー）
      if (side === "merge" && pair)
        return { bayId: pair.into.dripper ?? bayId, mergeKey: key, near };
      return {
        bayId,
        place: side === "before" ? { beforeKey: key } : { afterKey: key },
        near,
      };
    }
  }
  const bayId = bayTargetAt(clientX, clientY, { from, card });
  return bayId === null ? null : { bayId };
};

/** 落とす先の札（「→ 3」・「#012 の前へ（今から始める）」・「#012 の後ろへ（待機の先頭）」・「#012 と統合」） */
export const dropTargetLabel = (target: DropTarget | null) => {
  if (!target) return null;
  const { near } = target;
  if (!near) return `→ ${target.bayId}`;
  if (near.side === "merge") return `${near.label} と統合`;
  if (near.side === "before")
    return `${near.label} の前へ${near.brewing ? "（今から始める）" : ""}`;
  return `${near.label} の後ろへ${near.brewing ? "（待機の先頭）" : ""}`;
};

/** 指の下の列のカードに出す印（前・後ろの線か統合の枠）。そのカードでなければ undefined */
export const dropSideOn = (target: DropTarget | null, key: string) =>
  target?.near?.key === key ? target.near.side : undefined;

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

  /** カードの onPointerDown */
  const press = (source: S, event: React.PointerEvent<HTMLElement>) => {
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
