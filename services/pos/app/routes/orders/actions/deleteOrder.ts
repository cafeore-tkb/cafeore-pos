import { orderRepository } from "@cafeore/common";
import type { ClientActionFunction } from "@remix-run/react";

export const deleteOrder: ClientActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const id = formData.get("id");
  await orderRepository.delete(id as string);
  return null;
};
