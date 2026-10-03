import createClient from "openapi-fetch";
import type { paths } from "../types/api";
import { API_BASE_URL, throwApiError } from "./item";
import type { ColorSettingRepository } from "./type";

const client = createClient<paths>({ baseUrl: API_BASE_URL });

export const colorSettingRepoFactory = (): ColorSettingRepository => ({
  // 対象と画面の組が既にあれば上書きされる
  save: async ({ target_type, target_id, screen, color }) => {
    const { data, error, response } = await client.PUT("/api/color-settings", {
      body: { target_type, target_id, screen, color },
    });
    // 400 のレスポンス型があると error で data が絞り込まれないので、data も見る
    if (error || !response.ok || !data)
      return throwApiError(response, "Failed to save color setting");
    return data;
  },
  delete: async (id) => {
    const { error, response } = await client.DELETE(
      "/api/color-settings/{id}",
      { params: { path: { id } } },
    );
    if (error || !response.ok)
      await throwApiError(response, "Failed to delete color setting");
  },
  findAll: async () => {
    const { data, error, response } = await client.GET("/api/color-settings");
    if (error || !response.ok)
      await throwApiError(response, "Failed to fetch color settings");
    // レスポンスはモデルと同じ形なので、そのまま返す
    return data;
  },
});

export const colorSettingRepository = colorSettingRepoFactory();
