import {
  type Item,
  ItemEntity,
  type OrderEntity,
  type WithId,
  getItemMaster,
} from "@cafeore/common";

export function transformToteSet(order: OrderEntity): OrderEntity {
  const itemMaster = getItemMaster();
  const yusho = itemMaster.find((i) => i.name === "縁ブレンド");
  const toteSet = itemMaster.find((i) => i.name === "トートセット");

  if (!yusho || !toteSet) return order;
  const toteSetAssignees = order.items
    .filter((item) => item.id === toteSet.id)
    .map((item) => item.assignee);
  for (const assignee of toteSetAssignees) {
    order.items.push(
      ItemEntity.fromItem({
        ...yusho,
        price: 0,
        assignee: assignee,
      } as WithId<Item>),
    );
  }
  return order;
}
