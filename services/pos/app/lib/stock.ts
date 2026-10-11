import type { ItemEntity, StockResource, WithId } from "@cafeore/common";

/** アイテムの在庫の 1 回の量と、そのアイテムのタイプを使うカップ（「15g・ホットカップ」） */
export const itemStockSummary = (
  item: WithId<ItemEntity>,
  resources: StockResource[],
) => {
  const stock = resources.find((r) => r.item_id === item.id);
  const cups = resources
    .filter((r) => r.item_type_ids.some((id) => id === item.item_type.id))
    .map((r) => r.name);
  return [stock && `${stock.per_serving}${stock.unit}`, ...cups]
    .filter(Boolean)
    .join("・");
};
