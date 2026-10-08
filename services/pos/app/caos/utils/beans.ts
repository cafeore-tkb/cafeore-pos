import type { InventoryStatus, StockUsage } from "@cafeore/common";
import type { CardBean } from "../types";

// 商品 ID → その商品が使う豆（POS の在庫対象のうち kind が bean のもの）。
// 在庫の設定（/inventory/settings）の「商品ごとの使用量」をそのまま使い、名前で豆を決めない。
export type BeanIndex = Map<string, CardBean[]>;

export const buildBeanIndex = (
  statuses: InventoryStatus[],
  usages: StockUsage[],
): BeanIndex => {
  const index: BeanIndex = new Map();
  // 並びは在庫の画面と同じ（API の在庫対象の順）
  for (const { resource } of statuses) {
    if (resource.kind !== "bean") continue;
    for (const usage of usages) {
      if (usage.resource_id !== resource.id) continue;
      const beans = index.get(usage.item_id) ?? [];
      beans.push({ id: resource.id, name: resource.name });
      index.set(usage.item_id, beans);
    }
  }
  return index;
};

// カードの豆の名前（在庫対象の名前をそのまま）。豆が無ければ空
export const beanNamesOf = (card: { beans?: CardBean[] }) =>
  (card.beans ?? []).map((bean) => bean.name).join("・");

// 豆で絞り込む・まとめるときの判定。在庫の「商品 → 豆」の在庫対象の ID で比べる
// （豆を持たないカード（実データテスト）はどの豆にも当たらない）
export const cardHasBean = (card: { beans?: CardBean[] }, beanId: string) =>
  (card.beans ?? []).some((bean) => bean.id === beanId);
