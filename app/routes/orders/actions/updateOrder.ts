import type { ClientActionFunctionArgs } from "@remix-run/react";

import { orderRepository } from "~/repositories/order";

export const updateOrder = async ({ request }: ClientActionFunctionArgs) => {
  const formData = await request.formData();
  console.log("save(update)のテスト");
  const id2 = formData.get("id");
  const order = await orderRepository.findById(id2 as string);
  if (order) {
    order.beServed();
    await orderRepository.save(order);
  }
  return null;
};
