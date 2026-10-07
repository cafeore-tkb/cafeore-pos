import type { InventoryStatus, StockUsage } from "@cafeore/common";
import type { BeanCode, CardBean } from "../types";

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

// 豆で絞り込む・まとめるときの判定。盤面のカードは在庫対象の ID、
// 商品の情報が無い実データテストのカードは豆のコードで比べる
export const cardHasBean = (
  card: { beans?: CardBean[]; beanCode: BeanCode },
  beanKey: string,
) =>
  card.beans
    ? card.beans.some((bean) => bean.id === beanKey)
    : card.beanCode === beanKey;
