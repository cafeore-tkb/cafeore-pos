import type { ClientActionFunction } from "react-router";

import { createOrder } from "./actions/createOrder";
import { deleteOrder } from "./actions/deleteOrder";

export const clientAction: ClientActionFunction = async (args) => {
  const { request } = args;
  switch (request.method) {
    case "POST":
      return createOrder(args);
    case "DELETE":
      return deleteOrder(args);
    default:
      console.error("Invalid method", request.method);
      return new Response(null, { status: 405 });
  }
};
