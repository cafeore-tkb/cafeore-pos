import createClient from "openapi-fetch";
import { type WithId, hasId } from "../lib/typeguard";
import { type Item, ItemEntity } from "../models/item";
import type { components, paths } from "../types/api";
import type { ItemRepository } from "./type";

export const API_BASE_URL = "http://localhost:8080";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

// OpenAPI型のエイリアス
type ItemResponse = components["schemas"]["ItemResponse"];
type ItemCreateRequest = components["schemas"]["ItemCreateRequest"];
type ItemUpdateRequest = components["schemas"]["ItemUpdateRequest"];

// ItemResponse を Item に変換
const responseToItemEntity = (response: ItemResponse): WithId<ItemEntity> => {
  const item: WithId<Item> = {
    id: response.id,
    name: response.name,
    abbr: response.abbr,
    price: response.price,
    key: response.key,
    item_type: response.item_type,
    assignee: null,
  };
  return ItemEntity.fromItem(item);
};
// Item を CreateRequest に変換
const itemToCreateRequest = (item: Item): ItemCreateRequest => {
  return {
    name: item.name,
    abbr: item.abbr,
    price: item.price,
    key: item.key,
    item_type_id: item.item_type.id,
  };
};

// Item を UpdateRequest に変換
const itemToUpdateRequest = (item: WithId<Item>): ItemUpdateRequest => {
  return {
    id: item.id,
    name: item.name,
    abbr: item.abbr,
    price: item.price,
    key: item.key,
    item_type_id: item.item_type.id,
  };
};

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

export async function throwApiError(
  response: Response,
  fallback: string,
): Promise<never> {
  try {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error ?? fallback);
  } catch {
    throw new Error(fallback);
  }
}
