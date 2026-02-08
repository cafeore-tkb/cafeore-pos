import type { WithId } from "../lib/typeguard";
import type { ItemEntity } from "../models/item";
import { itemRepository, itemTypeRepository } from "../repositories";

export const itemMaster = await itemRepository.findAll();

export const itemTypes = await itemTypeRepository.findAll();

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
