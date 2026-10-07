import { apiClient, throwApiError } from "../api/client";
import {
  orderEntityToCreateRequest,
  orderToUpdateRequest,
  responseToOrderEntity,
} from "../api/converter";
import { type WithId, hasId } from "../lib/typeguard";
import type { OrderEntity } from "../models/order";
import type { OrderRepository } from "./type";

// TODO(toririm): エラーハンドリングをやる
// Result型を使う NeverThrow を使ってみたい
export const orderRepoFactory = (): OrderRepository => {
  // readyとserveをPATCHで行う
  const update = async (
    id: string,
    order: WithId<OrderEntity>,
  ): Promise<WithId<OrderEntity>> => {
    const { data, error, response } = await apiClient.PUT("/api/orders/{id}", {
      params: {
        path: { id },
      },
      body: orderToUpdateRequest(order),
    });

    if (error || !response.ok) {
      throwApiError(response, error, "Failed to update order");
    }

    return responseToOrderEntity(data);
  };

  const create = async (order: OrderEntity): Promise<WithId<OrderEntity>> => {
    const { data, error, response } = await apiClient.POST("/api/orders", {
      body: orderEntityToCreateRequest(order),
    });

    if (error || !response.ok) {
      throwApiError(response, error, "Failed to create order");
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
      const { data, error, response } = await apiClient.PATCH(
        "/api/orders/{id}/ready",
        {
          params: {
            path: { id },
          },
        },
      );

      if (error || !response.ok) {
        throwApiError(response, error, "Failed to mark order as ready");
      }
    },

    serve: async (id: string): Promise<void> => {
      const { data, error, response } = await apiClient.PATCH(
        "/api/orders/{id}/served",
        {
          params: {
            path: { id },
          },
        },
      );

      if (error || !response.ok) {
        throwApiError(response, error, "Failed to mark order as served");
      }
    },

    readyCup: async (id: string, cupId: string) => {
      const { data, error, response } = await apiClient.PATCH(
        "/api/orders/{id}/cups/{cupId}/ready",
        {
          params: {
            path: { id, cupId },
          },
        },
      );

      if (error || !data || !response.ok) {
        return throwApiError(response, error, "Failed to mark cup as ready");
      }

      return responseToOrderEntity(data);
    },

    serveCup: async (id: string, cupId: string) => {
      const { data, error, response } = await apiClient.PATCH(
        "/api/orders/{id}/cups/{cupId}/served",
        {
          params: {
            path: { id, cupId },
          },
        },
      );

      if (error || !data || !response.ok) {
        return throwApiError(response, error, "Failed to mark cup as served");
      }

      return responseToOrderEntity(data);
    },

    addComment: async (
      id: string,
      author: string,
      text: string,
    ): Promise<void> => {
      const { error, response } = await apiClient.POST(
        "/api/orders/{id}/comments",
        {
          params: {
            path: { id },
          },
          body: { author, text },
        },
      );

      if (error || !response.ok) {
        throwApiError(response, error, "Failed to add comment");
      }
    },

    delete: async (id) => {
      const { error, response } = await apiClient.DELETE("/api/orders/{id}", {
        params: {
          path: { id },
        },
      });

      if (error || !response.ok) {
        throwApiError(response, error, "Failed to delete order");
      }
    },

    findById: async (id) => {
      const { data, error, response } = await apiClient.GET(
        "/api/orders/{id}",
        {
          params: {
            path: { id },
          },
        },
      );

      if (response.status === 404) {
        return null;
      }

      if (error || !response.ok) {
        throwApiError(response, error, "Failed to fetch order");
      }

      return responseToOrderEntity(data);
    },

    findAll: async () => {
      const { data, error, response } = await apiClient.GET("/api/orders");

      if (error || !response.ok) {
        throwApiError(response, error, "Failed to fetch orders");
      }

      return data.map(responseToOrderEntity);
    },
  };
};

export const orderRepository: OrderRepository = orderRepoFactory();
