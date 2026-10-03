import type {
  StockResource,
  StockResourceInput,
  StockResourceKind,
  StockUsage,
} from "@cafeore/common";

export const stockResourceDefaults: Record<
  StockResourceKind,
  Omit<StockResourceInput, "name">
> = {
  cup: {
    kind: "cup",
    unit: "個",
    per_serving: 1,
    notify_from: 500,
    notify_step: 100,
    buffer: 100,
  },
  bean: {
    kind: "bean",
    unit: "g",
    per_serving: 15,
    notify_from: 100,
    notify_step: 20,
    buffer: 30,
  },
};

// アイテムタイプからカップを推測する。使用量の初期値にだけ使う。
const cupNameHints: Record<string, string> = {
  hot: "ホット",
  hotOre: "ホット",
  ice: "アイス",
  milk: "アイス",
  iceOre: "オレ",
};

export const guessCup = (
  itemTypeName: string | undefined,
  cups: StockResource[],
): StockResource | undefined => {
  const hint = itemTypeName && cupNameHints[itemTypeName];
  return hint ? cups.find((cup) => cup.name.includes(hint)) : undefined;
};

/** カップを先に、その後に豆を並べる */
export const sortResources = (resources: StockResource[]) => [
  ...resources.filter((r) => r.kind === "cup"),
  ...resources.filter((r) => r.kind === "bean"),
];

/** アイテムごとの使用量（在庫対象の ID → 量） */
export const usagesByItem = (usages: StockUsage[]) => {
  const byItem = new Map<string, Map<string, number>>();
  for (const { item_id, resource_id, amount } of usages) {
    const amounts = byItem.get(item_id) ?? new Map<string, number>();
    amounts.set(resource_id, amount);
    byItem.set(item_id, amounts);
  }
  return byItem;
};

/** 入力中の量（在庫対象の ID → 文字列）を API の形にする。空欄と 0 以下は使わない扱い */
export const toUsageInputs = (draft: Record<string, string>) =>
  Object.entries(draft).flatMap(([resource_id, value]) => {
    const amount = Number(value);
    return value.trim() !== "" && Number.isFinite(amount) && amount > 0
      ? [{ resource_id, amount }]
      : [];
  });
