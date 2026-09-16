// features/items/add.ts
import { ItemEntity, type ItemType } from "@cafeore/common";
import type { ItemFormValues } from "../../../components/organisms/itemForm";

export function buildNewItemEntity(
  values: ItemFormValues,
  itemTypes: ItemType[],
): ItemEntity {
  const itemType = itemTypes.find((t) => t.id === values.itemTypeId);
  if (!itemType) {
    throw new Error("item type が見つかりません");
  }

  const entity = ItemEntity.createNew({
    name: values.name,
    abbr: values.abbr,
    item_type: itemType,
  });
  return entity;
}
