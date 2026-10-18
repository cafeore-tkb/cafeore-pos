import type { CaosCard } from "@cafeore/common";
import { useEffect, useState } from "react";
import { type CardLooks, selectedComments } from "../logic/cards";
import type { CommentAnchor } from "./useCommentPopupPosition";

/**
 * ポップアップまたは右側のチャットに出す、見ている注文（orderLabel）のコメント。カードの印を押した注文はカードの近くに表示（×で閉じるか、ほかの注文を選ぶまで。選択を外しても残す）か、
 * 選んでいる注文。hidden（開いたカードのパネル・番号の検索がコメントを出している）のあいだは出さない。×は印を押した注文も選択もやめる
 */
export const useViewedComments = ({
  selectedOrderId,
  selectOrder,
  cards,
  looks,
  hidden,
}: {
  selectedOrderId: string | null;
  selectOrder: (orderId: string | null) => void;
  cards: readonly CaosCard[];
  looks: CardLooks;
  hidden: boolean;
}) => {
  const [pinned, setPinned] = useState<{
    label: string;
    anchor?: CommentAnchor;
  } | null>(null);
  // ほかの注文を選んだら、印を押した注文はやめて選んだ注文を出す
  useEffect(() => {
    if (selectedOrderId !== null) setPinned(null);
  }, [selectedOrderId]);
  const label = pinned?.label ?? selectedOrderId;
  const comments =
    label && !hidden ? selectedComments(cards, looks, label) : [];
  return {
    /** 見ている注文（パネルで見ているときも） */
    label,
    /** 表示するコメント（無ければ undefined） */
    viewing:
      label && comments.length > 0
        ? { label, comments, anchor: pinned?.anchor }
        : undefined,
    /** 印を押した注文のコメントを出す */
    open: (label: string, element?: HTMLElement) => {
      const target =
        element?.closest<HTMLElement>("[data-search-key]") ?? element;
      setPinned({
        label,
        anchor: target
          ? { element: target, rect: target.getBoundingClientRect() }
          : undefined,
      });
    },
    /** 閉じる（印を押した注文も選択もやめる） */
    close: () => {
      setPinned(null);
      selectOrder(null);
    },
  };
};
