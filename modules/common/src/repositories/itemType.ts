import { apiClient, throwApiError } from "../api/client";
import { type WithId, hasId } from "../lib/typeguard";
import type { ItemType } from "../models/item";
import type { ItemTypeRepository } from "./type";

// ItemType と API の種類のリクエスト・レスポンスは同じ形なので、変換せずにそのまま送り受けする
export const itemTypeRepoFactory = (): ItemTypeRepository => {
  const update = async (
    id: string,
    itemType: WithId<ItemType>,
  ): Promise<WithId<ItemType>> => {
    const { data, error, response } = await apiClient.PUT(
      "/api/item-types/{id}",
      {
        params: {
          path: { id },
        },
        body: itemType,
      },
    );

    if (error || !response.ok) {
      throwApiError(response, error, "Failed to update item type");
    }

    return data;
  };

  const create = async (itemType: ItemType): Promise<WithId<ItemType>> => {
    const { data, error, response } = await apiClient.POST("/api/item-types", {
      body: itemType,
    });

    if (error || !response.ok) {
      throwApiError(response, error, "Failed to create item type");
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
      const { error, response } = await apiClient.DELETE(
        "/api/item-types/{id}",
        {
          params: {
            path: { id },
          },
        },
      );

      if (error || !response.ok) {
        throwApiError(response, error, "Failed to delete item type");
      }
    },

    findById: async (id) => {
      const { data, error, response } = await apiClient.GET(
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
        throwApiError(response, error, "Failed to fetch item type");
      }

      return data;
    },

    findAll: async () => {
      const { data, error, response } = await apiClient.GET("/api/item-types");

      if (error || !response.ok) {
        throwApiError(response, error, "Failed to fetch item types");
      }

      return data;
    },
  };
};

export const itemTypeRepository: ItemTypeRepository = itemTypeRepoFactory();
