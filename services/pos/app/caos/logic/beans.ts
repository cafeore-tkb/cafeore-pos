import type {
  CaosCard,
  InventoryStatus,
  StockResource,
  StockUsage,
} from "@cafeore/common";

// カードの豆。POS の在庫の設定（/inventory/settings）の「商品ごとの使用量」で、商品が使う豆の在庫対象を引く。
// 名前で豆を決めない。豆の名前は在庫対象の名前をそのまま出す。

/** 商品 ID → その商品が使う豆（在庫対象のうち kind が bean のもの） */
export type BeanIndex = ReadonlyMap<string, StockResource[]>;

/** beanStatuses は在庫のうち豆（kind が bean）だけ */
export const buildBeanIndex = (
  beanStatuses: readonly InventoryStatus[],
  usages: readonly StockUsage[],
): BeanIndex => {
  const index = new Map<string, StockResource[]>();
  // 並びは在庫の画面と同じ（API の在庫対象の順）
  for (const { resource } of beanStatuses) {
    for (const usage of usages) {
      if (usage.resource_id !== resource.id) continue;
      index.set(usage.item_id, [...(index.get(usage.item_id) ?? []), resource]);
    }
  }
  return index;
};

/** カードの豆。カードのカップは同じ商品なので、先頭のカップの商品で引く。設定が無い商品は undefined */
export const cardBeans = (card: CaosCard, index: BeanIndex) =>
  index.get(card.cups[0].item.id);

/** 豆（在庫対象の ID）ごとの、盤面で待っている（未割当・待機・抽出中の）杯数。待っていない豆は入らない */
export const waitingCupsByBean = (
  cards: readonly CaosCard[],
  index: BeanIndex,
): Map<string, number> => {
  const cups = new Map<string, number>();
  for (const card of cards) {
    if (card.status === "done") continue;
    for (const bean of cardBeans(card, index) ?? []) {
      cups.set(bean.id, (cups.get(bean.id) ?? 0) + card.cups.length);
    }
  }
  return cups;
};
