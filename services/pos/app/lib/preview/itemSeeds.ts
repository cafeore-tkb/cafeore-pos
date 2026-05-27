import { ItemEntity, type WithId } from "@cafeore/common";

const previewSeedItemsRaw = [
  {
    id: "8a19dfd0-f0b8-4f2d-b4c6-0018f2d91f01",
    name: "ブレンドコーヒー",
    abbr: "BL",
    price: 450,
    key: "1",
    item_type: { id: "coffee-type", name: "coffee", display_name: "コーヒー" },
    assignee: null,
  },
  {
    id: "8a19dfd0-f0b8-4f2d-b4c6-0018f2d91f02",
    name: "アイスコーヒー",
    abbr: "IC",
    price: 500,
    key: "2",
    item_type: { id: "coffee-type", name: "coffee", display_name: "コーヒー" },
    assignee: null,
  },
  {
    id: "8a19dfd0-f0b8-4f2d-b4c6-0018f2d91f03",
    name: "カフェラテ",
    abbr: "CL",
    price: 550,
    key: "3",
    item_type: { id: "milk-type", name: "milk", display_name: "ミルク" },
    assignee: null,
  },
  {
    id: "8a19dfd0-f0b8-4f2d-b4c6-0018f2d91f04",
    name: "マフィン",
    abbr: "MF",
    price: 350,
    key: "4",
    item_type: { id: "food-type", name: "others", display_name: "フード" },
    assignee: null,
  },
] as const;

export const getPreviewSeedItems = (): WithId<ItemEntity>[] => {
  return previewSeedItemsRaw.map((item) => ItemEntity.fromItem(item));
};
