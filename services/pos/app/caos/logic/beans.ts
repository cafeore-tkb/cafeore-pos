import type { InventoryStatus, StockUsage } from "@cafeore/common";
import { type Board, mapCards } from "./board";
import type { CardBean } from "./cards";

// カードの豆。POS の在庫の設定（/inventory/settings）の「商品ごとの使用量」で、商品が使う豆の在庫対象を引く。
// 名前で豆を決めない。豆の名前は在庫対象の名前をそのまま出す。

/** 商品 ID → その商品が使う豆（在庫対象のうち kind が bean のもの） */
export type BeanIndex = Map<string, CardBean[]>;

/** beanStatuses は在庫のうち豆（kind が bean）だけ */
export const buildBeanIndex = (
  beanStatuses: readonly InventoryStatus[],
  usages: readonly StockUsage[],
): BeanIndex => {
  const index: BeanIndex = new Map();
  // 並びは在庫の画面と同じ（API の在庫対象の順）
  for (const { resource } of beanStatuses) {
    for (const usage of usages) {
      if (usage.resource_id !== resource.id) continue;
      index.set(usage.item_id, [
        ...(index.get(usage.item_id) ?? []),
        { id: resource.id, name: resource.name },
      ]);
    }
  }
  return index;
};

// 盤面のカードに豆を付ける。在庫の設定はあとから読み込まれたり変わったりするので、カードには持たず、出すたびに付ける
// （logic/posOrders.ts の paintBoard と同じ）。設定が無い商品は空。商品の無いカード（実データテスト）はそのまま。
export const attachBeans = (board: Board, index: BeanIndex): Board =>
  mapCards(board, (card) =>
    card.item
      ? { ...card, beans: (card.item.id && index.get(card.item.id)) || [] }
      : card,
  );

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
