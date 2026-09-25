import createClient from "openapi-fetch";
import type { paths } from "../types/api";
import { API_BASE_URL, throwApiError } from "./item";
import type { ColorSettingRepository } from "./type";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export const colorSettingRepoFactory = (): ColorSettingRepository => ({
  findAll: async () => {
    const { data, error, response } = await client.GET("/api/color-settings");
    if (error || !response.ok)
      await throwApiError(response, "Failed to fetch color settings");
    // レスポンスはモデルと同じ形なので、そのまま返す
    return data;
  },
});

export const colorSettingRepository = colorSettingRepoFactory();
