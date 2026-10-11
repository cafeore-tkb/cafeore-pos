import {
  type ItemEntity,
  type StockResource,
  type StockResourceInput,
  type WithId,
  inventoryRepository,
} from "@cafeore/common";

/**
 * アイテムの在庫の 1 回の量と、そのアイテムのタイプを使うカップ（「15g・ホットカップ」）。
 * カップを作らないタイプ（makes_cup が false）のアイテムはカップを減らさないので、カップは出さない
 */
export const itemStockSummary = (
  item: WithId<ItemEntity>,
  resources: StockResource[],
) => {
  const stock = resources.find((r) => r.item_id === item.id);
  const cups = item.item_type.makes_cup
    ? resources
        .filter((r) => r.item_type_ids.some((id) => id === item.item_type.id))
        .map((r) => r.name)
    : [];
  return [stock && `${stock.per_serving}${stock.unit}`, ...cups]
    .filter(Boolean)
    .join("・");
};

/** アイテムの在庫でもカップでも入れる値。アイテムの在庫にはこれだけを送る（名前はアイテムの名前） */
export type StockAmounts = Pick<
  StockResourceInput,
  "unit" | "per_serving" | "notify_from" | "notify_step" | "buffer"
>;

/** 入力欄。単位のほかは数 */
export const stockFields: {
  key: keyof StockAmounts;
  label: string;
  type: "text" | "number";
}[] = [
  { key: "unit", label: "単位", type: "text" },
  { key: "per_serving", label: "1回の量", type: "number" },
  { key: "notify_from", label: "通知開始", type: "number" },
  { key: "notify_step", label: "間隔", type: "number" },
  { key: "buffer", label: "バッファ", type: "number" },
];

/** 入力欄の文字を値にする。単位のほかは数 */
export const parseStockField = (key: keyof StockAmounts, raw: string) =>
  key === "unit" ? raw : Number(raw);

export const stockAmounts = (r: StockAmounts): StockAmounts => ({
  unit: r.unit,
  per_serving: r.per_serving,
  notify_from: r.notify_from,
  notify_step: r.notify_step,
  buffer: r.buffer,
});

/** draft のうち saved と違う値。saved が無ければ draft すべて */
export const stockChanges = (
  draft: Partial<StockAmounts>,
  saved?: StockAmounts,
): Partial<StockAmounts> =>
  Object.fromEntries(
    Object.entries(draft).filter(
      ([key, value]) => saved?.[key as keyof StockAmounts] !== value,
    ),
  );

/** アイテムの在庫の値を changes で変える（無ければ何もしない）。アイテムを作った直後でも引けるよう、在庫は取り直して探す */
export const saveItemStock = async (
  itemId: string,
  changes: Partial<StockAmounts>,
) => {
  if (Object.keys(changes).length === 0) return;
  const statuses = await inventoryRepository.getStatuses();
  const stock = statuses.find((s) => s.resource.item_id === itemId)?.resource;
  if (!stock) throw new Error("アイテムの在庫が見つかりません");
  await inventoryRepository.updateResource(stock.id, {
    ...stockAmounts(stock),
    ...changes,
  });
};
