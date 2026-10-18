import type { CaosCard } from "@cafeore/common";
import { useState } from "react";
import type { CardAction, CardBoardAction } from "../logic/cardActions";
import { orderLabel } from "../logic/cards";
import { caosLog } from "../utils/log";
import { useCaosStateLog } from "./useCaosStateLog";
import { useOutsidePress } from "./useOutsidePress";

/**
 * ドリッパーのカード（管制盤 A・C・D）の上に出す操作（logic/cardActions）。開くのはいつも 1 枚。
 * カードを押すと開き、もう一度押すか外を押すと閉じる（外を押した click はそのまま届けるので、ほかのカードを押せばそのカードが開く）。
 * アイコンを押すと閉じてから、盤面の操作（onRun）・入れ直しのパネル（onEmergency）・右下のコメント（onComments）を呼ぶ
 */
export const useCardMenu = ({
  onRun,
  onEmergency,
  onComments,
}: {
  onRun: (card: CaosCard, action: CardBoardAction) => void;
  onEmergency: (card: CaosCard) => void;
  onComments: (label: string, anchor?: HTMLElement) => void;
}) => {
  const [openKey, setOpenKey] = useState<string | null>(null);
  useCaosStateLog("ui.card-menu.changed", { openKey });
  useOutsidePress(
    openKey !== null,
    (target) =>
      Boolean(
        openKey && target.closest(`[data-search-key="${CSS.escape(openKey)}"]`),
      ),
    () => setOpenKey(null),
  );
  return {
    isOpen: (card: CaosCard) => card.key === openKey,
    toggle: (card: CaosCard) =>
      setOpenKey((key) => (key === card.key ? null : card.key)),
    run: (card: CaosCard, action: CardAction, anchor?: HTMLElement) => {
      caosLog("card.action", {
        action,
        cardKey: card.key,
        orderLabel: orderLabel(card),
        dripper: card.dripper,
        status: card.status,
        cupIds: card.cups.map((c) => c.cupId),
        unitIds: card.cups.map((c) => c.id),
      });
      setOpenKey(null);
      if (action === "emergency") onEmergency(card);
      else if (action === "comment") onComments(orderLabel(card), anchor);
      else onRun(card, action);
    },
  };
};
export type CardMenu = ReturnType<typeof useCardMenu>;
