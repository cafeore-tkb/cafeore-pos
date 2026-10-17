import {
  type CaosCard,
  type InventoryStatus,
  type ItemEntity,
  type StockResource,
  type WithId,
  cupNeedsBrew,
} from "@cafeore/common";

// カードの豆。カードの商品のアイテムの在庫（POS の在庫）を引く。名前で豆を決めない。豆の名前は在庫対象の名前をそのまま出す。

/** 商品 ID → その商品の在庫 */
export type BeanIndex = ReadonlyMap<string, StockResource>;

/** 豆残量確認に出す在庫。抽出が要る（種類の needs_brew。盤面のカードと同じ cupNeedsBrew）アイテムの在庫だけ。ミルクやグッズは出さない */
export const dripItemStatuses = (
  statuses: readonly InventoryStatus[],
  items: readonly WithId<ItemEntity>[],
) => {
  const dripItemIds = new Set(
    items.filter((item) => cupNeedsBrew({ item })).map((item) => item.id),
  );
  return statuses.filter(
    ({ resource }) => resource.item_id && dripItemIds.has(resource.item_id),
  );
};

/** statuses は dripItemStatuses で絞ったもの */
export const buildBeanIndex = (
  statuses: readonly InventoryStatus[],
): BeanIndex => {
  const index = new Map<string, StockResource>();
  for (const { resource } of statuses) {
    if (resource.item_id) index.set(resource.item_id, resource);
  }
  return index;
};

/** カードの豆。カードのカップは同じ商品なので、先頭のカップの商品で引く。在庫が無い商品は undefined */
export const cardBean = (card: CaosCard, index: BeanIndex) =>
  index.get(card.cups[0].item.id);

/** 豆（在庫対象の ID）ごとの、盤面で待っている（未割当・待機・抽出中の）杯数。待っていない豆は入らない */
export const waitingCupsByBean = (
  cards: readonly CaosCard[],
  index: BeanIndex,
): Map<string, number> => {
  const cups = new Map<string, number>();
  for (const card of cards) {
    const bean = cardBean(card, index);
    if (card.status === "done" || !bean) continue;
    cups.set(bean.id, (cups.get(bean.id) ?? 0) + card.cups.length);
  }
  return cups;
};
