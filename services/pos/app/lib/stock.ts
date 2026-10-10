import type { StockResource, StockUsage } from "@cafeore/common";

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
