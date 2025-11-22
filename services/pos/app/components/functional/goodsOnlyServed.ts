import type { OrderEntity } from "@cafeore/common";

export function goodsOnlyServed(order: OrderEntity): OrderEntity {
  if (order.getDrinkCups().length === 0) {
    order.beServed();
  }
  return order;
}
