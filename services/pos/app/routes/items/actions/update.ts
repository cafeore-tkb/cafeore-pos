// features/items/update.ts
import { ItemEntity, type ItemType, type WithId } from "@cafeore/common";
import type { ItemFormValues } from "../../../components/organisms/itemForm";

export function buildUpdatedItemEntity(
  id: string,
  values: ItemFormValues,
  itemTypes: ItemType[],
): WithId<ItemEntity> {
  const itemType = itemTypes.find((t) => t.id === values.itemTypeId);
  if (!itemType) {
    throw new Error("item type が見つかりません");
  }

  const entity = ItemEntity.fromItem({
    id,
    name: values.name,
    abbr: values.abbr,
    price: Number(values.price),
    key: values.key,
    item_type: itemType,
    assignee: values.assignee || null,
  });

  return entity;
}
