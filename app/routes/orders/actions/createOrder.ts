import type { ClientActionFunction } from "@remix-run/react";

import { OrderEntity } from "~/models/order";
import { orderRepository } from "~/repositories/order";

export const createOrder: ClientActionFunction = async () => {
  console.log("save(create)のテスト");
  const newOrder = OrderEntity.createNew({ orderId: 1 });
  const savedOrder = await orderRepository.save(newOrder);
  console.log("created", savedOrder);
  return null;
};
