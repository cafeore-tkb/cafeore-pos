import { OrderEntity, orderRepository } from "@cafeore/common";
import type { ClientActionFunction } from "@remix-run/react";

export const createOrder: ClientActionFunction = async () => {
  console.log("save(create)のテスト");
  const newOrder = OrderEntity.createNew({ orderId: 1 });
  const savedOrder = await orderRepository.save(newOrder);
  console.log("created", savedOrder);
  return null;
};
