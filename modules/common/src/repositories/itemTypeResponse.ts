import { type WithId, hasId } from "../lib/typeguard";
import type { ItemTypeResponse } from "../models/item";
import { API_BASE_URL } from "./itemResponse";
import type { ItemTypeResponseRepository } from "./type";

// APIやり取り用の仮itemTypeRepository
export const itemTypeResponseRepoFactory = (): ItemTypeResponseRepository => {
  const update = async (
    id: string,
    itemType: ItemTypeResponse,
  ): Promise<WithId<ItemTypeResponse>> => {
    const response = await fetch(`${API_BASE_URL}/api/item-types/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(itemType),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to update item-type");
    }
    return response.json();
  };

  const create = async (
    itemType: ItemTypeResponse,
  ): Promise<WithId<ItemTypeResponse>> => {
    const response = await fetch(`${API_BASE_URL}/api/item-types`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(itemType),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to create item-type");
    }
    return response.json();
  };

  return {
    save: async (itemType) => {
      if (hasId(itemType)) {
        return await update(itemType.id, itemType);
      }
      return await create(itemType);
    },

    delete: async (id: string): Promise<void> => {
      const response = await fetch(`${API_BASE_URL}/api/item-types/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete item");
      }
    },

    findById: async (id) => {
      const response = await fetch(`${API_BASE_URL}/api/item-types/${id}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch item");
      }
      return response.json();
    },

    findAll: async () => {
      const response = await fetch(`${API_BASE_URL}/api/item-types`);
      if (!response.ok) {
        throw new Error("Failed to fetch items");
      }
      return response.json();
    },
  };
};

export const itemTypeResponseRepository: ItemTypeResponseRepository =
  itemTypeResponseRepoFactory();
