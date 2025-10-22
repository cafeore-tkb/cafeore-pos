import { ITEM_MASTER, ItemEntity, type OrderEntity } from "@cafeore/common";

export function transformToteSet(order: OrderEntity): OrderEntity {
  const yusho = ITEM_MASTER["-"];
  const toteSet = ITEM_MASTER["@"];
  const toteSetAssinees = order.items
    .filter((item) => item.id === toteSet.id)
    .map((item) => item.assignee);
  for (const assignee of toteSetAssinees) {
    order.items.push(
      ItemEntity.fromItem({ ...yusho, price: 0, assignee: assignee }),
    );
  }
  console.dir(order);
  return order;
}
