import type { MenuEntity } from "./menu";

/**
 * ドリッパーを3人以上確保する注文かどうかを判定する
 * 条件：
 * - メニューの構成品ごとに数える（セットメニューは中のコーヒーで数える）
 * - コーヒーの種類が1種類なら4杯までならtrue、5杯以上ならfalse
 * - コーヒーの種類が2種類なら、1種類につき2杯までならtrue、3杯以上のものが1種類でもあればfalse
 * @param menus 注文メニューの配列
 * @returns 分割が必要かどうかのboolean値
 */
export function shouldSplitOrder(menus: MenuEntity[]): boolean {
  const coffeeCounts = new Map<string, number>();

  for (const menu of menus) {
    for (const { item, quantity } of menu.items) {
      if (item.item_type.name === "milk" || item.item_type.name === "others") {
        continue;
      }
      coffeeCounts.set(item.id, (coffeeCounts.get(item.id) ?? 0) + quantity);
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
