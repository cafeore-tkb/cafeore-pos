import { ITEM_MASTER } from "../data/items";
import type { WithId } from "../lib/typeguard";
import type { ItemEntity } from "./item";

/**
 * ドリッパーを3人以上確保する注文かどうかを判定する
 * 条件：
 * - トートセットは縁ブレンドとして扱う
 * - コーヒーの種類が1種類なら4杯までならtrue、5杯以上ならfalse
 * - コーヒーの種類が2種類なら、1種類につき2杯までならtrue、3杯以上のものが1種類でもあればfalse
 * @param items 注文アイテムの配列
 * @returns 分割が必要かどうかのboolean値
 */
export function shouldSplitOrder(items: WithId<ItemEntity>[]): boolean {
  const yushoId = ITEM_MASTER["-"].id;
  const toteSetsId = ITEM_MASTER["@"].id;

  // トートセットを縁ブレンドとして扱い、種類別にカウント
  const coffeeCounts = new Map<string, number>();

  for (const item of items) {
    if (item.type !== "milk" && item.type !== "others") {
      // 通常のコーヒー
      coffeeCounts.set(item.id, (coffeeCounts.get(item.id) || 0) + 1);
    } else if (item.id === toteSetsId) {
      // トートセットは縁ブレンドとして扱う
      coffeeCounts.set(yushoId, (coffeeCounts.get(yushoId) || 0) + 1);
    }
  }

  const types = coffeeCounts.size;
  const counts = Array.from(coffeeCounts.values());

  return (
    types >= 3 ||
    (types === 2 && counts.some((count) => count >= 3)) ||
    (types === 1 && counts[0] >= 5)
  );
}
