import createClient from "openapi-fetch";
import { type WithId, hasId } from "../lib/typeguard";
import type { ItemType } from "../models/item";
import type { paths } from "../types/api";
import { API_BASE_URL, throwApiError } from "./item";
import type { ItemTypeRepository } from "./type";

// ItemType と API の種類のリクエスト・レスポンスは同じ形なので、変換せずにそのまま送り受けする
const client = createClient<paths>({ baseUrl: API_BASE_URL });

export const itemTypeRepoFactory = (): ItemTypeRepository => {
  const update = async (
    id: string,
    itemType: WithId<ItemType>,
  ): Promise<WithId<ItemType>> => {
    const { data, error, response } = await client.PUT("/api/item-types/{id}", {
      params: {
        path: { id },
      },
      body: itemType,
    });

    if (error || !response.ok) {
      await throwApiError(response, "Failed to update item");
    }

    return data;
  };

  const create = async (itemType: ItemType): Promise<WithId<ItemType>> => {
    const { data, error, response } = await client.POST("/api/item-types", {
      body: itemType,
    });

    if (error || !response.ok) {
      await throwApiError(response, "Failed to create item");
    }

    return data;
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

      return data;
    },

    findAll: async () => {
      const { data, error, response } = await client.GET("/api/item-types");

      if (error || !response.ok) {
        throw new Error("Failed to fetch items");
      }

      return data;
    },
  };
};

export const itemTypeRepository: ItemTypeRepository = itemTypeRepoFactory();
