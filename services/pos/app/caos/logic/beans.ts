import type { InventoryStatus, StockResource } from "@cafeore/common";
import { type Board, mapCards } from "./board";

// カードの豆。カードの商品のアイテムの在庫（POS の在庫）を引く。名前で豆を決めない。豆の名前は在庫対象の名前をそのまま出す。

/** 商品 ID → その商品の在庫 */
type BeanIndex = Map<string, StockResource[]>;

/** statuses はアイテムの在庫（kind が item）だけ */
export const buildBeanIndex = (
  statuses: readonly InventoryStatus[],
): BeanIndex => {
  const index: BeanIndex = new Map();
  for (const { resource } of statuses) {
    if (resource.item_id) index.set(resource.item_id, [resource]);
  }
  return index;
};

// 盤面のカードに豆を付ける。在庫の設定はあとから読み込まれたり変わったりするので、カードには持たず、出すたびに付ける
// （logic/posOrders.ts の paintBoard と同じ）。設定が無い商品と、商品の無いカード（実データテスト）はそのまま。
export const attachBeans = (board: Board, index: BeanIndex): Board =>
  mapCards(board, (card) => {
    const beans = card.item?.id && index.get(card.item.id);
    return beans ? { ...card, beans } : card;
  });

/** 豆（在庫対象の ID）ごとの、盤面で待っている（未割当・待機・抽出中の）杯数。待っていない豆は入らない */
export const waitingCupsByBean = (board: Board): Map<string, number> => {
  const cups = new Map<string, number>();
  const waiting = [
    ...board.unassigned,
    ...board.baristas.flatMap((barista) => barista.queue),
  ];
  for (const card of waiting) {
    for (const bean of card.beans ?? []) {
      cups.set(bean.id, (cups.get(bean.id) ?? 0) + card.cupCount);
    }
  }
  return cups;
};
