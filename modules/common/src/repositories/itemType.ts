import createClient from "openapi-fetch";
import { type WithId, hasId } from "../lib/typeguard";
import type { ItemType } from "../models/item";
import type { components, paths } from "../types/api";
import { API_BASE_URL, throwApiError } from "./item";
import type { ItemTypeRepository } from "./type";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

// OpenAPI型のエイリアス
type ItemTypeResponse = components["schemas"]["ItemTypeResponse"];
type ItemTypeCreateRequest = components["schemas"]["ItemTypeCreateRequest"];
type ItemTypeUpdateRequest = components["schemas"]["ItemTypeUpdateRequest"];

// ItemTypeResponse を ItemType に変換
const responseToItemType = (response: ItemTypeResponse): WithId<ItemType> => {
  return {
    id: response.id,
    name: response.name,
    display_name: response.display_name,
  };
};
// ItemType を CreateRequest に変換
const itemTypeToCreateRequest = (itemType: ItemType): ItemTypeCreateRequest => {
  return {
    name: itemType.name,
    display_name: itemType.display_name,
  };
};

// Item を UpdateRequest に変換
const itemTypeToUpdateRequest = (
  itemType: WithId<ItemType>,
): ItemTypeUpdateRequest => {
  return {
    id: itemType.id,
    name: itemType.name,
    display_name: itemType.display_name,
  };
};

export const itemTypeRepoFactory = (): ItemTypeRepository => {
  const update = async (
    id: string,
    itemType: WithId<ItemType>,
  ): Promise<WithId<ItemType>> => {
    const { data, error, response } = await client.PUT("/api/item-types/{id}", {
      params: {
        path: { id },
      },
      body: itemTypeToUpdateRequest(itemType),
    });

    if (error || !response.ok) {
      await throwApiError(response, "Failed to update item");
    }

    return responseToItemType(data);
  };

  const create = async (itemType: ItemType): Promise<WithId<ItemType>> => {
    const { data, error, response } = await client.POST("/api/item-types", {
      body: itemTypeToCreateRequest(itemType),
    });

    if (error || !response.ok) {
      await throwApiError(response, "Failed to create item");
    }

    return responseToItemType(data);
  };

  return {
    save: async (itemType) => {
      if (hasId(itemType)) {
        return await update(itemType.id, itemType);
      }
      return await create(itemType);
    },

    delete: async (id: string): Promise<void> => {
      const { error, response } = await client.DELETE("/api/item-types/{id}", {
        params: {
          path: { id },
        },
      });

      if (error || !response.ok) {
        await throwApiError(response, "Failed to delete itemType");
      }
    },

    findById: async (id) => {
      const { data, error, response } = await client.GET(
        "/api/item-types/{id}",
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
        throw new Error("Failed to fetch item");
      }

      return responseToItemType(data);
    },

    findAll: async () => {
      const { data, error, response } = await client.GET("/api/item-types");

      if (error || !response.ok) {
        throw new Error("Failed to fetch items");
      }

      return data.map(responseToItemType);
    },
  };
};

export const itemTypeRepository: ItemTypeRepository = itemTypeRepoFactory();
