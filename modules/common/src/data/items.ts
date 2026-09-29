// data/items.ts
import useSWR from "swr";
import type { WithId } from "../lib/typeguard";
import type { MenuEntity } from "../models/menu";
import {
  itemRepository,
  itemTypeRepository,
  menuRepository,
} from "../repositories";

const ITEM_MASTER_KEY = "item-master";
const ITEM_TYPES_KEY = "item-types";
const MENU_MASTER_KEY = "menu-master";

const fetchItems = async () => {
  return await itemRepository.findAll();
};

const fetchItemTypes = async () => {
  return await itemTypeRepository.findAll();
};

const fetchMenus = async () => menuRepository.findAll();

export const useMenuMaster = () => {
  const {
    data: menus = [],
    error,
    isLoading,
    mutate,
  } = useSWR(MENU_MASTER_KEY, fetchMenus);

  const keyEventHandler = (
    e: KeyboardEvent,
    func: (menu: WithId<MenuEntity>) => void,
  ) => {
    const menu = menus.find((candidate) => candidate.key === e.key);
    if (!menu) return;
    e.preventDefault();
    func(menu);
  };

  return {
    menus,
    items: menus,
    error,
    isLoading,
    mutateMenus: mutate,
    keyEventHandler,
  };
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

  return {
    items,
    itemTypes,
    isLoading: itemsLoading || itemTypesLoading,
    error: itemsError ?? itemTypesError,
    mutateItems,
    mutateItemTypes,
  };
};
