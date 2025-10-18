import { ITEM_MASTER, ItemEntity, type OrderEntity } from "@cafeore/common";

export function transformToteSet(order: OrderEntity): OrderEntity {
  const yusho = ITEM_MASTER["-"];
  const toteSet = ITEM_MASTER["@"];
  if (order.items.find((item) => item.id === toteSet.id)) {
    order.items.push(
      ItemEntity.fromItem({ ...yusho, price: 0, assignee: null }),
    );
  }
  console.dir(order);
  return order;
}
