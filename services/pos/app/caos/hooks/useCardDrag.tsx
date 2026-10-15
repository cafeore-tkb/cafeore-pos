import {
  type CaosCard,
  type CaosPlace,
  caosDripperAllowed,
  caosMergePair,
} from "@cafeore/common";
import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isBayId } from "../logic/lanes";

// カードのドラッグ。管制盤 A（タイムラインの待機カード・未割当）・C（未割当）・D（右の注文と表の待機カード）で共通。
// 12px 動くまではタップ、それより動かすと向きに関係なくすぐ掴む（カードは touch-action none。枠のスクロールは ScrollArea のバー）。
// 掴んだカードはその場に残し、指には写し（ghost）が付いて動く（スクロールする枠に切られない）。
// 置き先は targetAt（指の下。bayTargetAt など）で決め、離したら onDrop。ドラッグのあとのクリックは捨てる。
// onHold を渡すと、12px より動かさずに HOLD_MS 押し続けたら長押し（onHold が true を返したら、ドラッグは始めず、離したときのクリックも捨てる）。
// 動かし始めたら長押しにはならない（なぞったらすぐ掴むのはそのまま）。Apple Pencil・マウスも同じ。
const DRAG_THRESHOLD_PX = 12;
const HOLD_MS = 600;

// 長押しのあとの、指を離したときのクリックを捨てる。開いたパネルの「外を押したら閉じる」（document の capture で見る）より先に、
// window の capture で止める。クリックが来なければ（指の長押し）、次に押したときにやめる
const swallowNextClick = () => {
  const swallow = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    stop();
  };
  const stop = () => {
    window.removeEventListener("click", swallow, true);
    window.removeEventListener("pointerdown", stop, true);
  };
  window.addEventListener("click", swallow, true);
  window.addEventListener("pointerdown", stop, true);
};

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
 * ドラッグで落とす先。bayId はドリッパー（列）、place はその列の待機・抽出中のカードの前（{ beforeKey }。抽出中のカードの前は列の先頭）。
 * place が無ければ、その列の待機の最後へ。mergeKey があれば、そのカード（待機・抽出中）に統合する
 */
export interface DropTarget {
  bayId: number;
  place?: CaosPlace;
  /** 統合する相手のカード（key） */
  mergeKey?: string;
  /** 前に入れる・統合する相手のカードの表示（注文番号） */
  beforeLabel?: string;
}

// 待機のカードの上で、左からこの割合より右に落とすと統合（統合できるカードだけ）。左は「このカードの前へ」
const MERGE_FROM = 0.4;

/**
 * 落とす先（管制盤 A・C）。1〜6 のボタンが下にあればそのボタン（列の最後）。列のカード（data-merge-target）の上で、
 * 運んでいるカード（card）と統合できる（caosMergePair。cards から引く。運んでいるのが抽出中なら相手を抽出中に入れる）なら統合
 * （待機のカードは右の部分だけ。抽出中・未割当のカードは全部。抽出中のカードの前（列の先頭）へは、統合できないときだけ）、
 * 列の待機・抽出中のカード（data-queued-ticket）の上ならそのカードの前（同じ列の中の入れ替えにも使う）、ほかは列（最後。bayTargetAt）。
 * 運んでいるカード自身は飛ばし、置けない列は null
 */
export const dropTargetAt = (
  clientX: number,
  clientY: number,
  {
    from,
    card,
    cards = [],
  }: { from?: number; card?: CaosCard; cards?: readonly CaosCard[] } = {},
): DropTarget | null => {
  const elements = document.elementsFromPoint(clientX, clientY);
  if (!elements.some(isBayButton)) {
    for (const element of elements) {
      const target = element.closest<HTMLElement>("[data-merge-target]");
      const into = cards.find(
        (other) => other.key === target?.dataset.mergeTarget,
      );
      if (!target || !into || !card) continue;
      const pair = caosMergePair(card, into);
      if (!pair) continue;
      const rect = target.getBoundingClientRect();
      if (
        into.status === "queued" &&
        clientX < rect.left + rect.width * MERGE_FROM
      )
        break;
      // 統合したカードの場所（運んでいるのが抽出中なら、そのドリッパー）
      return {
        bayId: pair.into.dripper ?? 0,
        mergeKey: into.key,
        beforeLabel: target.dataset.ticketLabel,
      };
    }
    for (const element of elements) {
      const ticket = element.closest<HTMLElement>("[data-queued-ticket]");
      const key = ticket?.dataset.queuedTicket;
      if (!ticket || !key || key === card?.key) continue;
      const bayId = Number(
        ticket.parentElement?.closest<HTMLElement>("[data-bay-target]")?.dataset
          .bayTarget,
      );
      if (!isBayId(bayId) || (card && !caosDripperAllowed(card, bayId)))
        return null;
      return {
        bayId,
        place: { beforeKey: key },
        beforeLabel: ticket.dataset.ticketLabel,
      };
    }
  }
  const bayId = bayTargetAt(clientX, clientY, { from, card });
  return bayId === null ? null : { bayId };
};

/** 落とす先の札（「→ 3」・「→ 3 #012 の前」・「→ 3 #012 と統合」） */
export const dropTargetLabel = (target: DropTarget | null) => {
  if (!target) return null;
  if (target.mergeKey) return `→ ${target.bayId} ${target.beforeLabel} と統合`;
  return target.beforeLabel
    ? `→ ${target.bayId} ${target.beforeLabel} の前`
    : `→ ${target.bayId}`;
};

export const useCardDrag = <S, T>(handlers: {
  targetAt: (source: S, clientX: number, clientY: number) => T | null;
  onBegin?: (source: S) => void;
  onDrop: (source: S, target: T) => void;
  /** 動かさずに押し続けた（長押し）。長押しにしたら true（false ならそのまま。動かせばドラッグ） */
  onHold?: (source: S) => boolean;
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
    const hold =
      latest.current.onHold &&
      window.setTimeout(() => {
        if (!latest.current.onHold?.(source)) return;
        cleanup();
        swallowNextClick();
      }, HOLD_MS);

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
        window.clearTimeout(hold);
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
      window.clearTimeout(hold);
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

/**
 * 長押しだけ（ドラッグしないカード。管制盤 C のドリッパーの列・A と D の終わったカード）。useCardDrag と同じ決まりで、動かしたら長押しにならない。
 * press をカードの onPointerDown に、suppressClick を onClickCapture に渡す
 */
export const useCardHold = <S,>(onHold: (source: S) => void) => {
  const { press, suppressClick } = useCardDrag<S, never>({
    targetAt: () => null,
    onDrop: () => {},
    onHold: (source) => {
      onHold(source);
      return true;
    },
  });
  return { press, suppressClick };
};
