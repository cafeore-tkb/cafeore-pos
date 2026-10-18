import { type CaosCard, caosCardServed } from "@cafeore/common";
import { useEffect, useRef } from "react";
import { soundManager } from "../utils/audio";

/** 初回読込は鳴らさず、提供済みになったカードを3音で知らせる。再描画では繰り返さない。 */
export const useServedCardAlert = (
  cards: readonly CaosCard[],
  loaded: boolean,
  scope: string,
) => {
  // iPadでも、通常の画面操作で音を有効にできるようにする。
  useEffect(() => {
    const unlock = () => soundManager.unlock();
    const events = ["pointerup", "touchend", "keydown"] as const;
    for (const event of events) window.addEventListener(event, unlock);
    return () => {
      for (const event of events) window.removeEventListener(event, unlock);
    };
  }, []);
  const previous = useRef<{ scope: string; served: Set<string> } | null>(null);
  useEffect(() => {
    if (!loaded) {
      previous.current = null;
      return;
    }
    const served = new Set(
      cards.filter(caosCardServed).map((card) => card.key),
    );
    const before = previous.current;
    previous.current = { scope, served };
    if (!before || before.scope !== scope) return;
    if ([...served].some((key) => !before.served.has(key)))
      soundManager.playServed();
  }, [cards, loaded, scope]);
};
