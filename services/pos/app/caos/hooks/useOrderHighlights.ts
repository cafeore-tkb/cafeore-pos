import type { CaosCard } from "@cafeore/common";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  type HighlightOrder,
  cardOrders,
  labelOrders,
  selectHighlights,
} from "../logic/orderHighlights";

export const OrderHighlightsContext = createContext<OrderHighlights | null>(
  null,
);
export const useOrderHighlights = () => useContext(OrderHighlightsContext);
export type OrderHighlights = ReturnType<typeof useOrderHighlightState>;

/** 操作の選択・メニューとは独立した、端末内だけの強調状態。 */
export function useOrderHighlightState(
  cards: readonly CaosCard[],
  scope: string,
  revealCard: (key: string) => void,
) {
  const [orders, setOrders] = useState<HighlightOrder[]>([]);
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const gesture = useRef({
    pointerId: -1,
    x: 0,
    y: 0,
    moved: false,
    active: false,
    until: 0,
  });
  const clear = useCallback(
    () => setOrders((previous) => (previous.length ? [] : previous)),
    [],
  );
  const select = useCallback(
    (targets: readonly { id: string; no: number }[]) => {
      setOrders((previous) => selectHighlights(targets, previous));
    },
    [],
  );
  const selectCard = useCallback(
    (card: CaosCard, orderId?: string, keyboard = false) => {
      if (
        !keyboard &&
        gesture.current.moved &&
        performance.now() < gesture.current.until
      )
        return;
      select(
        cardOrders(card).filter((order) => !orderId || order.id === orderId),
      );
    },
    [select],
  );
  const selectLabel = useCallback(
    (label: string, orderId?: string) => {
      select(labelOrders(cardsRef.current, label, orderId));
    },
    [select],
  );

  useEffect(() => {
    // 日付・本番/練習の切替だけでリセット。カップの消失・移動では解除しない。
    void scope;
    clear();
  }, [scope, clear]);
  useEffect(() => {
    const down = (event: PointerEvent) => {
      if (!event.isPrimary) return;
      gesture.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        moved: false,
        active: true,
        until: 0,
      };
    };
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current.active || current.pointerId !== event.pointerId) return;
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) > 8)
        current.moved = true;
    };
    const end = (event: PointerEvent) => {
      if (gesture.current.pointerId !== event.pointerId) return;
      gesture.current.active = false;
      if (event.type === "pointercancel") gesture.current.moved = true;
      gesture.current.until = performance.now() + 700;
    };
    const scroll = () => {
      if (gesture.current.active) gesture.current.moved = true;
    };
    const click = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (
        event.detail > 0 &&
        gesture.current.moved &&
        performance.now() < gesture.current.until
      )
        return;
      if (
        event.target.closest(
          "[data-order-highlight-card], [data-order-highlight-preserve]",
        )
      )
        return;
      // 表示だけを解除。元のクリックは止めず、そのまま操作先へ渡す。
      clear();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointermove", move, true);
    document.addEventListener("pointerup", end, true);
    document.addEventListener("pointercancel", end, true);
    document.addEventListener("scroll", scroll, true);
    document.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointermove", move, true);
      document.removeEventListener("pointerup", end, true);
      document.removeEventListener("pointercancel", end, true);
      document.removeEventListener("scroll", scroll, true);
      document.removeEventListener("click", click, true);
    };
  }, [clear]);
  return { orders, selectCard, selectLabel, clear, revealCard };
}
