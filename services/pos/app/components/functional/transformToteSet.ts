import { ITEM_MASTER, ItemEntity, type OrderEntity } from "@cafeore/common";
import { count } from "firebase/firestore";

export function transformToteSet(order: OrderEntity): OrderEntity {
  const yusho = ITEM_MASTER["-"];
  const toteSet = ITEM_MASTER["@"];
  let toteSetCount = order.items.filter((item) => item.id === toteSet.id).length;
  while (toteSetCount > 0) {
    order.items.push(
      ItemEntity.fromItem({ ...yusho, price: 0, assignee: null }),
    );
    toteSetCount--;
  }
  console.dir(order);
  return order;
}
