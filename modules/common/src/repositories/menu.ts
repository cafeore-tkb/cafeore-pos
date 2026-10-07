import { apiClient, throwApiError } from "../api/client";
import {
  menuToCreateRequest,
  menuToUpdateRequest,
  responseToMenuEntity,
} from "../firebase-utils";
import { type WithId, hasId } from "../lib/typeguard";
import type { MenuEntity } from "../models/menu";
import type { MenuRepository } from "./type";

export const menuRepoFactory = (): MenuRepository => {
  const create = async (menu: MenuEntity): Promise<WithId<MenuEntity>> => {
    const { data, error, response } = await apiClient.POST("/api/menus", {
      body: menuToCreateRequest(menu),
    });
    if (error || !response.ok)
      throwApiError(response, error, "Failed to create menu");
    return responseToMenuEntity(data);
  };

  const update = async (
    menu: WithId<MenuEntity>,
  ): Promise<WithId<MenuEntity>> => {
    const { data, error, response } = await apiClient.PUT("/api/menus/{id}", {
      params: { path: { id: menu.id } },
      body: menuToUpdateRequest(menu),
    });
    if (error || !response.ok)
      throwApiError(response, error, "Failed to update menu");
    return responseToMenuEntity(data);
  };

  return {
    save: async (menu) => (hasId(menu) ? update(menu) : create(menu)),
    delete: async (id) => {
      const { error, response } = await apiClient.DELETE("/api/menus/{id}", {
        params: { path: { id } },
      });
      if (error || !response.ok)
        throwApiError(response, error, "Failed to delete menu");
    },
    findById: async (id) => {
      const { data, error, response } = await apiClient.GET("/api/menus/{id}", {
        params: { path: { id } },
      });
      if (response.status === 404) return null;
      if (error || !response.ok)
        throwApiError(response, error, "Failed to fetch menu");
      return responseToMenuEntity(data);
    },
    findAll: async () => {
      const { data, error, response } = await apiClient.GET("/api/menus");
      if (error || !response.ok)
        throwApiError(response, error, "Failed to fetch menus");
      return data.map(responseToMenuEntity);
    },
  };
};

export const menuRepository = menuRepoFactory();
