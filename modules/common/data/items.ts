import { IncludedIn, type WithId } from "../lib/typeguard";
import { type Item, ItemEntity } from "../models/item";

type RawItemSource = {
  [keymap: string]: Omit<WithId<Item>, "assignee"> & { abbr: string };
};

export const ITEM_MASTER = {
  "-": {
    id: "01_beppin_brend",
    name: "べっぴんブレンド",
    abbr: "べっぴん",
    price: 500,
    type: "hot",
  },
  "^": {
    id: "02_cafeore_brend",
    name: "珈琲・俺ブレンド",
    abbr: "俺ブレ",
    price: 300,
    type: "hot",
  },
  "/": {
    id: "03_special",
    name: "限定",
    abbr: "限定",
    price: 1000,
    type: "hot",
  },
  ";": {
    id: "04_mandheling",
    name: "マンデリン",
    abbr: "マンデ",
    price: 400,
    type: "hot",
  },
  ":": {
    id: "05_pink_bourbon",
    name: "ピンクブルボン",
    abbr: "ピンク",
    price: 400,
    type: "hot",
  },
  "]": {
    id: "06_costa_rica_red_honey",
    name: "コスタリカ レッドハニー",
    abbr: "コスタ",
    price: 400,
    type: "hot",
  },
  "\\": {
    id: "10_ice_coffee",
    name: "アイスコーヒー",
    abbr: "氷",
    price: 400,
    type: "ice",
  },
  "@": {
    id: "20_hot_ore",
    name: "ホットオレ",
    abbr: "Hotオレ",
    price: 500,
    type: "hotOre",
  },
  "[": {
    id: "30_ice_ore",
    name: "アイスオレ",
    abbr: "Iceオレ",
    price: 500,
    type: "iceOre",
  },
  ".": {
    id: "40_ice_milk",
    name: "アイスミルク",
    abbr: "ミルク",
    price: 100,
    type: "milk",
  },
  ",": {
    id: "50_coaster",
    name: "コースター",
    abbr: "コースター",
    price: 100,
    type: "others",
  },
} as const satisfies RawItemSource;

type Keys = keyof typeof ITEM_MASTER;

type Values = (typeof ITEM_MASTER)[Keys];

export const itemSource: WithId<ItemEntity>[] = Object.entries(ITEM_MASTER).map(
  ([_key, item]) => ItemEntity.fromItem({ ...item, assignee: null }),
);

export const key2item = (key: Keys) =>
  ItemEntity.fromItem({ ...ITEM_MASTER[key], assignee: null });

export const id2abbr = (id: string): Values["abbr"] | undefined =>
  Object.entries(ITEM_MASTER)
    .map(([_key, value]) => value)
    .find((item) => item.id === id)?.abbr;

export const keyEventHandler = (
  e: KeyboardEvent,
  func: (item: WithId<ItemEntity>) => void,
) => {
  const key = e.key;
  if (IncludedIn(ITEM_MASTER, key)) {
    e.preventDefault();
    func(key2item(key));
  }
};
