import createClient from "openapi-fetch";
import {
  itemToCreateRequest,
  itemToUpdateRequest,
  responseToItemEntity,
} from "../firebase-utils";
import { type WithId, hasId } from "../lib/typeguard";
import type { ItemEntity } from "../models/item";
import type { paths } from "../types/api";
import type { ItemRepository } from "./type";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export const itemRepoFactory = (): ItemRepository => {
  const update = async (
    id: string,
    item: WithId<ItemEntity>,
  ): Promise<WithId<ItemEntity>> => {
    const { data, error, response } = await client.PUT("/api/items/{id}", {
      params: {
        path: { id },
      },
      body: itemToUpdateRequest(item),
    });

    if (error || !response.ok) {
      await throwApiError(response, "Failed to update item");
    }

    return responseToItemEntity(data);
  };

  const create = async (item: ItemEntity): Promise<WithId<ItemEntity>> => {
    const { data, error, response } = await client.POST("/api/items", {
      body: itemToCreateRequest(item),
    });

    if (error || !response.ok) {
      await throwApiError(response, "Failed to create item");
    }

    return responseToItemEntity(data);
  };

  return {
    save: async (item) => {
      if (hasId(item)) {
        return await update(item.id, item);
      }
      return await create(item);
    },

    delete: async (id: string): Promise<void> => {
      const { error, response } = await client.DELETE("/api/items/{id}", {
        params: {
          path: { id },
        },
      });

      if (error || !response.ok) {
        await throwApiError(response, "Failed to delete item");
      }
    },

    findById: async (id) => {
      const { data, error, response } = await client.GET("/api/items/{id}", {
        params: {
          path: { id },
        },
      });

      if (response.status === 404) {
        return null;
      }

      if (error || !response.ok) {
        throw new Error("Failed to fetch item");
      }

      return responseToItemEntity(data);
    },

    findAll: async () => {
      const { data, error, response } = await client.GET("/api/items");

      if (error || !response.ok) {
        throw new Error("Failed to fetch items");
      }

      return data.map(responseToItemEntity);
    },
  };
};

export const itemRepository: ItemRepository = itemRepoFactory();

/**
 * API のエラーを Error にして投げる。API は { error: string } を返す。
 *
 * openapi-fetch はエラー時の本文を読み終えて error に入れているので、
 * 渡されていればそちらを使う。どちらからも取れなければ fallback を使う
 */
export async function throwApiError(
  response: Response,
  fallback: string,
  error?: unknown,
): Promise<never> {
  if (hasErrorMessage(error)) {
    throw new Error(error.error);
  }
  let message = fallback;
  try {
    const body = (await response.json()) as unknown;
    if (hasErrorMessage(body)) {
      message = body.error;
    }
  } catch {}
  throw new Error(message);
}

const hasErrorMessage = (body: unknown): body is { error: string } =>
  typeof body === "object" &&
  body !== null &&
  "error" in body &&
  typeof body.error === "string";
