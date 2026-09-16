import createClient from "openapi-fetch";
import {
  menuToCreateRequest,
  menuToUpdateRequest,
  responseToMenuEntity,
} from "../firebase-utils";
import { hasId, type WithId } from "../lib/typeguard";
import type { MenuEntity } from "../models/menu";
import type { paths } from "../types/api";
import { API_BASE_URL, throwApiError } from "./item";
import type { MenuRepository } from "./type";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export const menuRepoFactory = (): MenuRepository => {
  const create = async (menu: MenuEntity): Promise<WithId<MenuEntity>> => {
    const { data, error, response } = await client.POST("/api/menus", {
      body: menuToCreateRequest(menu),
    });
    if (error || !response.ok)
      await throwApiError(response, "Failed to create menu");
    return responseToMenuEntity(data);
  };

  const update = async (
    menu: WithId<MenuEntity>,
  ): Promise<WithId<MenuEntity>> => {
    const { data, error, response } = await client.PUT("/api/menus/{id}", {
      params: { path: { id: menu.id } },
      body: menuToUpdateRequest(menu),
    });
    if (error || !response.ok)
      await throwApiError(response, "Failed to update menu");
    return responseToMenuEntity(data);
  };

  return {
    save: async (menu) => (hasId(menu) ? update(menu) : create(menu)),
    delete: async (id) => {
      const { error, response } = await client.DELETE("/api/menus/{id}", {
        params: { path: { id } },
      });
      if (error || !response.ok)
        await throwApiError(response, "Failed to delete menu");
    },
    findById: async (id) => {
      const { data, error, response } = await client.GET("/api/menus/{id}", {
        params: { path: { id } },
      });
      if (response.status === 404) return null;
      if (error || !response.ok)
        await throwApiError(response, "Failed to fetch menu");
      return responseToMenuEntity(data);
    },
    findAll: async () => {
      const { data, error, response } = await client.GET("/api/menus");
      if (error || !response.ok)
        await throwApiError(response, "Failed to fetch menus");
      return data.map(responseToMenuEntity);
    },
  };
};

export const menuRepository = menuRepoFactory();
