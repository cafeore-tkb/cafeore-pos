import { ITEM_MASTER, ItemEntity, type OrderEntity } from "@cafeore/common";

export function transformToteSet(order: OrderEntity): OrderEntity {
  const yusho = ITEM_MASTER["-"];
  const toteSet = ITEM_MASTER["@"];
  const toteSetCount = order.items.filter((item) => item.id === toteSet.id).length;
  for (let i = 0; i < toteSetCount; i++) {
    order.items.push(
      ItemEntity.fromItem({ ...yusho, price: 0, assignee: null }),
    );
  }
  console.dir(order);
  return order;
}
