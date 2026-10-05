import type { ItemEntity, MenuEntity, WithId } from "@cafeore/common";

// 削除すると参照先が消えるので、使っている側の名前を id ごとに集める
export type Usage = Map<string, string[]>;

export const itemUsage = (menus: WithId<MenuEntity>[]): Usage => {
  const usage: Usage = new Map();
  for (const menu of menus) {
    for (const { item } of menu.items) {
      usage.set(item.id, [...(usage.get(item.id) ?? []), menu.name]);
    }
  }
  return usage;
};

export const itemTypeUsage = (items: WithId<ItemEntity>[]): Usage => {
  const usage: Usage = new Map();
  for (const item of items) {
    const typeId = item.item_type.id;
    if (!typeId) continue;
    usage.set(typeId, [...(usage.get(typeId) ?? []), item.name]);
  }
  return usage;
};
