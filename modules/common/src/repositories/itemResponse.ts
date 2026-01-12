import { type WithId, hasId } from "../lib/typeguard";
import type { ItemResponse } from "../models/item";
import type { ItemResponseRepository } from "./type";

export const API_BASE_URL = "http://localhost:8080";

// APIやり取り用の仮itemRepository
export const itemResponseRepoFactory = (): ItemResponseRepository => {
  const update = async (
    id: string,
    item: ItemResponse,
  ): Promise<WithId<ItemResponse>> => {
    const response = await fetch(`${API_BASE_URL}/api/items/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(item),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to update item");
    }
    return response.json();
  };

  const create = async (item: ItemResponse): Promise<WithId<ItemResponse>> => {
    const response = await fetch(`${API_BASE_URL}/api/items`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(item),
    });
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || "Failed to create item");
    }
    return response.json();
  };

  return {
    save: async (item) => {
      if (hasId(item)) {
        return await update(item.id, item);
      }
      return await create(item);
    },

    delete: async (id: string): Promise<void> => {
      const response = await fetch(`${API_BASE_URL}/api/items/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete item");
      }
    },

    findById: async (id) => {
      const response = await fetch(`${API_BASE_URL}/api/items/${id}`);
      if (response.status === 404) {
        return null;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch item");
      }
      return response.json();
    },

    findAll: async () => {
      const response = await fetch(`${API_BASE_URL}/api/items`);
      if (!response.ok) {
        throw new Error("Failed to fetch items");
      }
      return response.json();
    },
  };
};

export const itemResponseRepository: ItemResponseRepository =
  itemResponseRepoFactory();
