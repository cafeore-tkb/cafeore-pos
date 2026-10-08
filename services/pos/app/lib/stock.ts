import type { StockResource, StockUsage } from "@cafeore/common";

/**
 * タイプ（ID）ごとに、そのタイプのアイテムにいちばん多く入っているカップ（ID）。
 * 新しいアイテムや、カップが空のアイテムに入れる初期値にだけ使う。
 * タイプの名前やカップの名前で決め打ちせず、いま DB に入っている使用量から決める
 */
export const cupByItemType = (
  items: { id?: string; item_type: { id?: string } }[],
  usages: { item_id: string; resource_id: string }[],
  resources: StockResource[],
): Map<string, string> => {
  const cups = resources.filter((r) => r.kind === "cup");
  const typeOf = new Map(items.map((item) => [item.id, item.item_type.id]));
  const counts = new Map<string, Map<string, number>>();
  for (const { item_id, resource_id } of usages) {
    const typeId = typeOf.get(item_id);
    if (!typeId || !cups.some((cup) => cup.id === resource_id)) continue;
    const byCup = counts.get(typeId) ?? new Map<string, number>();
    byCup.set(resource_id, (byCup.get(resource_id) ?? 0) + 1);
    counts.set(typeId, byCup);
  }
  // 同数ならカップの並び順で先のもの
  return new Map(
    [...counts].map(([typeId, byCup]) => {
      const max = Math.max(...byCup.values());
      const cup = cups.find((c) => byCup.get(c.id) === max);
      return [typeId, cup?.id ?? ""];
    }),
  );
};

/** カップを先に、その後に豆を並べる */
export const sortResources = (resources: StockResource[]) => [
  ...resources.filter((r) => r.kind === "cup"),
  ...resources.filter((r) => r.kind === "bean"),
];

/** アイテムの ID → 在庫対象の ID → 量（入力の形） */
export const usageDrafts = (usages: StockUsage[]) => {
  const drafts: Record<string, Record<string, string>> = {};
  for (const { item_id, resource_id, amount } of usages) {
    drafts[item_id] = { ...drafts[item_id], [resource_id]: String(amount) };
  }
  return drafts;
};

/** 入力中の量（在庫対象の ID → 文字列）を API の形にする。空欄と 0 以下は使わない扱い */
export const toUsageInputs = (draft: Record<string, string>) =>
  Object.entries(draft).flatMap(([resource_id, value]) => {
    const amount = Number(value);
    return value.trim() !== "" && Number.isFinite(amount) && amount > 0
      ? [{ resource_id, amount }]
      : [];
  });
