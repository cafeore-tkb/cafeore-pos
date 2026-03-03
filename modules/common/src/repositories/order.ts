import createClient from "openapi-fetch";
import {
  orderEntityToCreateRequest,
  orderToUpdateRequest,
  responseToOrderEntity,
} from "../firebase-utils/converter";
import { type WithId, hasId } from "../lib/typeguard";
import type { OrderEntity } from "../models/order";
import type { paths } from "../types/api";
import { API_BASE_URL, throwApiError } from "./item";
import type { OrderRepository } from "./type";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

// TODO(toririm): エラーハンドリングをやる
// Result型を使う NeverThrow を使ってみたい
export const orderRepoFactory = (): OrderRepository => {
  // readyとserveをPATCHで行う
  const update = async (
    id: string,
    order: WithId<OrderEntity>,
  ): Promise<WithId<OrderEntity>> => {
    const { data, error, response } = await client.PUT("/api/orders/{id}", {
      params: {
        path: { id },
      },
      body: orderToUpdateRequest(order),
    });

    if (error || !response.ok) {
      await throwApiError(response, "Failed to update item");
    }

    return responseToOrderEntity(data);
  };

  const create = async (order: OrderEntity): Promise<WithId<OrderEntity>> => {
    const { data, error, response } = await client.POST("/api/orders", {
      body: orderEntityToCreateRequest(order),
    });

    if (error || !response.ok) {
      await throwApiError(response, "Failed to create item");
    }

    const returnedOrder = responseToOrderEntity(data);
    if (returnedOrder) {
      return returnedOrder;
    }
    throw new Error("Failed to save order");
  };

  return {
    save: async (order) => {
      if (hasId(order)) {
        return await update(order.id, order);
      }
      return await create(order);
    },

    ready: async (id: string): Promise<void> => {
      const { data, error, response } = await client.PATCH(
        "/api/orders/{id}/ready",
        {
          params: {
            path: { id },
          },
        },
      );

      if (error || !response.ok) {
        await throwApiError(response, "Failed to mark order as ready");
      }
    },

    serve: async (id: string): Promise<void> => {
      const { data, error, response } = await client.PATCH(
        "/api/orders/{id}/served",
        {
          params: {
            path: { id },
          },
        },
      );

      if (error || !response.ok) {
        await throwApiError(response, "Failed to mark order as served");
      }
    },

    addComment: async (
      id: string,
      author: string,
      text: string,
    ): Promise<void> => {
      const { error, response } = await client.POST(
        "/api/orders/{id}/comments",
        {
          params: {
            path: { id },
          },
          body: { author, text },
        },
      );

      if (error || !response.ok) {
        await throwApiError(response, "Failed to add comment");
      }
    },

    delete: async (id) => {
      await client.DELETE("/api/orders/{id}", {
        params: {
          path: { id },
        },
      });
    },

    findById: async (id) => {
      const { data, error, response } = await client.GET("/api/orders/{id}", {
        params: {
          path: { id },
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (error || !response.ok) {
        throw new Error("Failed to fetch order");
      }

      return responseToOrderEntity(data);
    },

    findAll: async () => {
      const { data, error, response } = await client.GET("/api/orders");

      if (error || !response.ok) {
        throw new Error("Failed to fetch items");
      }

      console.log("raw order data:", data); // APIレスポンス確認
      return data.map(responseToOrderEntity);
    },
  };
};

export const orderRepository: OrderRepository = orderRepoFactory();
