// data/items.ts
import useSWR from "swr";
import type { WithId } from "../lib/typeguard";
import type { ItemEntity } from "../models/item";
import { itemRepository, itemTypeRepository } from "../repositories";

const ITEM_MASTER_KEY = "item-master";
const ITEM_TYPES_KEY = "item-types";

const fetchItems = async () => {
  return await itemRepository.findAll();
};

const fetchItemTypes = async () => {
  return await itemTypeRepository.findAll();
};

export const useItemMaster = () => {
  const {
    data: items = [],
    error: itemsError,
    isLoading: itemsLoading,
    mutate: mutateItems,
  } = useSWR(ITEM_MASTER_KEY, fetchItems);

  const {
    data: itemTypes = [],
    error: itemTypesError,
    isLoading: itemTypesLoading,
    mutate: mutateItemTypes,
  } = useSWR(ITEM_TYPES_KEY, fetchItemTypes);

  const key2item = (key: string) => {
    const item = items.find((i) => i.key === key);
    if (!item) {
      throw new Error(`item not found: ${key}`);
    }
    return item;
  };

  const id2abbr = (id: string): string | undefined => {
    const item = items.find((i) => i.id === id);
    return item?.abbr;
  };

  const keyEventHandler = (
    e: KeyboardEvent,
    func: (item: WithId<ItemEntity>) => void,
  ) => {
    const key = e.key;
    const item = items.find((i) => i.key === key);

    if (!item) {
      return;
    }

    e.preventDefault();
    func(item);
  };

  return {
    items,
    itemTypes,
    isLoading: itemsLoading || itemTypesLoading,
    error: itemsError ?? itemTypesError,
    mutateItems,
    mutateItemTypes,
    key2item,
    id2abbr,
    keyEventHandler,
  };
};
