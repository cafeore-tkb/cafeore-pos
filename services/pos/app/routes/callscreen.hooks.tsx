import type { Order } from "@cafeore/common";
import { gsap } from "gsap";
import { useEffect, useRef, useState } from "react";

type GsapCSSVars = Record<string, string | number | (() => void)>;

/**
 * オーダーの状態が変化したかを判定するヘルパー関数
 */
function isOrderReadyStateChanged(
  prev: Order | undefined,
  current: Order,
): boolean {
  return (
    prev?.readyAt === null &&
    current.readyAt !== null &&
    current.servedAt === null
  );
}

/**
 * オーダーが準備中に戻ったかを判定するヘルパー関数
 */
function isOrderUnreadyStateChanged(
  prev: Order | undefined,
  current: Order,
): boolean {
  return prev?.readyAt !== null && current.readyAt === null;
}

/**
 * オーダー状態管理フック
 * オーダーの状態（準備中 → 提供可能）の変化を監視し、
 * 適切な処理（キュー追加、表示更新など）を実行します。
 */
export function useOrderState(orders: Order[] | undefined) {
  const [queue, setQueue] = useState<number[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [displayedOrders, setDisplayedOrders] = useState<Set<number>>(
    new Set(),
  );
  const prevOrdersRef = useRef<typeof orders>();
  const animatedRightCardsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!orders) return;

    // 初期化処理: 既に準備完了のオーダーを表示リストに追加
    if (!prevOrdersRef.current) {
      const existingReadyOrders = orders.filter(
        (order) => order.readyAt !== null && order.servedAt === null,
      );
      setDisplayedOrders(new Set(existingReadyOrders.map((o) => o.orderId)));
      prevOrdersRef.current = orders;
      return;
    }

    // 新しく準備完了になったオーダーを検出し、キューに追加
    const newlyReady = orders.filter((order) => {
      const prev = prevOrdersRef.current?.find((p) => p.id === order.id);
      return isOrderReadyStateChanged(prev, order);
    });

    if (newlyReady.length > 0) {
      setQueue((prev) => [...prev, ...newlyReady.map((o) => o.orderId)]);
    }

    // 準備中に戻ったオーダーを検出し、アニメーション履歴から削除
    const newlyUnready = orders.filter((order) => {
      const prev = prevOrdersRef.current?.find((p) => p.id === order.id);
      return isOrderUnreadyStateChanged(prev, order);
    });

    // 再び準備完了になった際にアニメーションが再生されるよう、履歴をクリア
    for (const order of newlyUnready) {
      animatedRightCardsRef.current.delete(order.orderId);
    }

    prevOrdersRef.current = orders;
  }, [orders]);

  return {
    queue,
    current,
    displayedOrders,
    animatedRightCardsRef,
    setQueue,
    setCurrent,
    setDisplayedOrders,
  };
}

/**
 * スライドアウトアニメーション管理フック
 * 左側のカードを右にスライドさせて、画面外に移動させるアニメーションを実行します。
 */
export function useCallScreenAnimation(
  current: number | null,
  currentElementRef: React.RefObject<HTMLDivElement>,
  onComplete: (orderId: number) => void,
) {
  useEffect(() => {
    if (current === null || !currentElementRef.current) return;

    const element = currentElementRef.current;
    const currentOrderId = current;

    // 初期位置をリセット（アニメーション開始時の状態）
    gsap.set(element, { x: 0, opacity: 1 });

    // 右方向にスライドアウトするアニメーション（1秒後に開始）
    gsap.to(element, {
      x: window.innerWidth * 0.1,
      opacity: 0,
      duration: 0.5,
      delay: 1,
      ease: "power2.in",
      onComplete: () => {
        onComplete(currentOrderId);
      },
    });

    // クリーンアップ: アニメーションを中断し、スタイルをリセット
    return () => {
      gsap.killTweensOf(element);
      gsap.set(element, { clearProps: "all" });
    };
  }, [current, currentElementRef, onComplete]);
}

/**
 * キュー処理フック
 * 現在表示中のオーダーが完了したら、次のオーダーをキューから取り出して表示します。
 * 一定時間待ってから次を表示することで、アニメーションが途切れないようにしています。
 */
export function useQueueProcessing(
  current: number | null,
  queue: number[],
  setCurrent: (orderId: number) => void,
  setQueue: React.Dispatch<React.SetStateAction<number[]>>,
) {
  useEffect(() => {
    // 現在表示中のオーダーが存在する場合は何もしない
    if (current !== null) return;
    // キューが空の場合は何もしない
    if (queue.length === 0) return;

    // 次のオーダーを一定時間後に表示（前のアニメーションとの間隔を空ける）
    const timerId = setTimeout(() => {
      setQueue((prev) => {
        const next = prev[0];
        if (next !== undefined) {
          setCurrent(next);
        }
        return prev.slice(1);
      });
    }, 500);

    return () => clearTimeout(timerId);
  }, [current, queue, setCurrent, setQueue]);
}

/**
 * スライドインアニメーション管理フック
 * 右側のカードを左からスライドインさせ、同時にオレンジ色からテール色にグラデーションを変化させるアニメーションを実行します。
 */
export function useSlideInAnimation(
  newlyAddedOrderId: number | null,
  cardRefs: React.RefObject<Map<number, HTMLDivElement>>,
  textRefs: React.RefObject<Map<number, HTMLDivElement>>,
  animatedCardsRef: React.RefObject<Set<number>>,
  onComplete: () => void,
) {
  useEffect(() => {
    if (newlyAddedOrderId === null) return;

    const id = newlyAddedOrderId;
    const cardElement = cardRefs.current?.get(id);
    const textElement = textRefs.current?.get(id);

    // 要素が存在しない、または既にアニメーション済みの場合はスキップ
    if (!cardElement || !textElement || animatedCardsRef.current?.has(id)) {
      onComplete();
      return;
    }

    // カードの初期状態をセット（左側に隠れた状態、透明）
    gsap.set(cardElement, {
      x: -100,
      opacity: 0,
    });

    // テキストのグラデーション初期色をセット（オレンジ系）
    gsap.set(textElement, {
      "--grad-start": "#f97316", // orange-500
      "--grad-mid": "#ea580c", // orange-600
      "--grad-end": "#ef4444", // red-500
    } as GsapCSSVars);

    // カードのスライドインアニメーション（左から中心へ移動、同時に不透明化）
    gsap.to(cardElement, {
      x: 0,
      opacity: 1,
      duration: 0.5,
      ease: "power2.out",
    });

    // テキストのグラデーションカラーアニメーション（オレンジ → テール）
    // スライドイン完了後に少し待ってから色を切り替える
    gsap.to(textElement, {
      "--grad-start": "#14b8a6", // teal-500
      "--grad-mid": "#0d9488", // teal-600
      "--grad-end": "#14b8a6", // teal-500
      duration: 1,
      delay: 1.0, // スライドイン完了後、さらに0.5秒待ってから色変更を開始
      ease: "power2.out",
      onComplete: () => {
        // アニメーション完了を記録し、コールバックを実行
        animatedCardsRef.current?.add(id);
        onComplete();
      },
    });

    // クリーンアップ: アニメーションを中断
    return () => {
      gsap.killTweensOf([cardElement, textElement]);
    };
  }, [newlyAddedOrderId, cardRefs, textRefs, animatedCardsRef, onComplete]);
}
