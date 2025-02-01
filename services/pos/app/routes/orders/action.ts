import type { ClientActionFunction } from "@remix-run/react";

import { createOrder } from "./actions/createOrder";
import { deleteOrder } from "./actions/deleteOrder";
import { updateOrder } from "./actions/updateOrder";

export const clientAction: ClientActionFunction = async (args) => {
  const { request } = args;
  switch (request.method) {
    case "POST":
      return createOrder(args);
    case "DELETE":
      return deleteOrder(args);
    case "PUT":
      return updateOrder(args);
    default:
      console.error("Invalid method", request.method);
      return new Response(null, { status: 405 });
  }
};
