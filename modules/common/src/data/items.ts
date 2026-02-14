import type { WithId } from "../lib/typeguard";
import type { ItemEntity } from "../models/item";
import { itemRepository, itemTypeRepository } from "../repositories";

// データを格納する変数
let itemMaster: Awaited<ReturnType<typeof itemRepository.findAll>> = [];
let itemTypes: Awaited<ReturnType<typeof itemTypeRepository.findAll>> = [];

// 初期化関数
export async function initializeItemMaster() {
  itemMaster = await itemRepository.findAll();
  itemTypes = await itemTypeRepository.findAll();
}

// ゲッター関数としてエクスポート
export const getItemMaster = () => itemMaster;
export const getItemTypes = () => itemTypes;

export const key2item = (key: string) => {
  const item = itemMaster.find((i) => i.key === key);
  if (!item) {
    throw new Error(`item not found: ${key}`);
  }
  return item;
};

export const id2abbr = (id: string): string | undefined => {
  const item = itemMaster.find((i) => i.id === id);
  return item?.abbr;
};

export const keyEventHandler = (
  e: KeyboardEvent,
  func: (item: WithId<ItemEntity>) => void,
) => {
  const key = e.key;
  const hasKeyItem = itemMaster.find((i) => i.key === key);
  if (hasKeyItem) {
    e.preventDefault();
    const item = key2item(key);
    if (item) {
      func(item);
    }
  }
};
